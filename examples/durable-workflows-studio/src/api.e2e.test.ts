import test from "node:test";
import assert from "node:assert/strict";
import {
  createTestStudio,
  getDetail,
  startWorkflow,
  waitForNodeState,
  waitForStatus,
  type StudioTestClient,
  type StudioWorkflow,
} from "./studio.test-support.js";

async function withStudio(
  fn: (client: StudioTestClient) => Promise<void>,
): Promise<void> {
  const client = await createTestStudio();
  try {
    await fn(client);
  } finally {
    await client.dispose();
  }
}

test("lists the workflow catalog", async () => {
  await withStudio(async (client) => {
    const listed = await client.get<{ workflows: StudioWorkflow[] }>(
      "/api/workflows",
    );
    assert.equal(listed.status, 200);
    assert.deepEqual(
      listed.body.workflows.map((workflow) => workflow.key).sort(),
      [
        "incidentResponse",
        "portfolioReconciliation",
        "processOrder",
        "regionalRollup",
        "userOnboarding",
      ],
    );
    const one = await client.get<{ workflow: StudioWorkflow }>(
      "/api/workflows/processOrder",
    );
    assert.equal(one.status, 200);
    assert.equal(one.body.workflow.graph.nodes.length, 5);
    const missing = await client.get("/api/workflows/nope");
    assert.equal(missing.status, 404);
  });
});

test("order lifecycle: sleep, signal wait, ship", async () => {
  await withStudio(async (client) => {
    const executionId = await startWorkflow(client, "processOrder", {
      orderId: "ORD-E2E",
      customerId: "CUST-E2E",
      amount: 12.5,
      processingDelayMs: 200,
    });

    const waiting = await waitForNodeState(
      client,
      executionId,
      "__signal:awaitPaymentConfirmation",
      "waiting",
    );
    assert.equal(waiting.status, "sleeping");
    assert.match(waiting.position ?? "", /paymentConfirmed/);
    const signalNode = waiting.timeline.find(
      (node) => node.id === "__signal:awaitPaymentConfirmation",
    )!;
    assert.equal(signalNode.wait?.signalId, "paymentConfirmed");
    assert.equal(
      waiting.timeline.find((node) => node.id === "__sleep:processingDelay")
        ?.state,
      "completed",
    );

    const signalled = await client.post(
      `/api/executions/${executionId}/signals`,
      { signal: "paymentConfirmed", payload: { transactionId: "txn_e2e" } },
    );
    assert.equal(signalled.status, 202);

    const done = await waitForStatus(client, executionId, "completed");
    assert.deepEqual(done.result, {
      orderId: "ORD-E2E",
      transactionId: "txn_e2e",
      status: "shipped",
      shippedAt: (done.result as { shippedAt: number }).shippedAt,
    });
    assert.ok(
      done.timeline.every((node) => node.state === "completed"),
      "every node completed",
    );
    assert.ok(done.audit.length > 0, "audit trail recorded");
    assert.equal(done.position, "Completed");
  });
});

test("onboarding timeout path skips provisioning", async () => {
  await withStudio(async (client) => {
    const executionId = await startWorkflow(client, "userOnboarding", {
      email: "timeout@example.com",
      plan: "free",
      verificationTimeoutMs: 300,
    });

    const done = await waitForStatus(client, executionId, "completed", 20_000);
    assert.equal(
      (done.result as { verified: boolean }).verified,
      false,
    );
    assert.equal((done.result as { workspace: unknown }).workspace, null);
    const branch = done.timeline.find(
      (node) => node.id === "provisionBranch",
    )!;
    assert.equal(branch.state, "completed");
    assert.equal(branch.branchTaken, "timed-out");
    assert.equal(
      done.timeline.find((node) => node.id === "provisionResources")?.state,
      "skipped",
    );
  });
});

test("incident happy path: ack, approve, resolve", async () => {
  await withStudio(async (client) => {
    const executionId = await startWorkflow(client, "incidentResponse", {
      incidentId: "INC-E2E",
      severity: "SEV-2",
      summary: "drill",
      ackTimeoutMs: 30_000,
      approvalTimeoutMs: 30_000,
    });

    await waitForNodeState(client, executionId, "__signal:awaitAck", "waiting");
    const acked = await client.post(
      `/api/executions/${executionId}/signals`,
      {
        signal: "incidentAcknowledged",
        payload: { acknowledgedBy: "ada", acknowledgedAt: Date.now() },
      },
    );
    assert.equal(acked.status, 202);

    await waitForNodeState(
      client,
      executionId,
      "__signal:awaitApproval",
      "waiting",
    );
    const approved = await client.post(
      `/api/executions/${executionId}/signals`,
      {
        signal: "approvalDecision",
        payload: { approved: true, decidedBy: "ops-lead" },
      },
    );
    assert.equal(approved.status, 202);

    const done = await waitForStatus(client, executionId, "completed");
    assert.equal((done.result as { outcome: string }).outcome, "resolved");
    assert.equal(
      done.timeline.find((node) => node.id === "ackBranch")?.branchTaken,
      "acked",
    );
    assert.equal(
      done.timeline.find((node) => node.id === "approvalBranch")?.branchTaken,
      "approved",
    );
    assert.equal(
      done.timeline.find((node) => node.id === "remediate")?.state,
      "completed",
    );
    assert.equal(
      done.timeline.find((node) => node.id === "escalate")?.state,
      "skipped",
    );
  });
});

test("executions list filters by workflow and status", async () => {
  await withStudio(async (client) => {
    await startWorkflow(client, "processOrder", {
      orderId: "ORD-F",
      customerId: "C",
      amount: 1,
      processingDelayMs: 30_000,
    });
    await startWorkflow(client, "userOnboarding", {
      email: "f@example.com",
      plan: "free",
      verificationTimeoutMs: 30_000,
    });

    const filtered = await client.get<{ executions: { id: string }[] }>(
      "/api/executions?workflowKey=processOrder",
    );
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.executions.length, 1);

    const firstPage = await client.get<{
      executions: { id: string }[];
      hasMore: boolean;
      nextOffset: number | null;
    }>("/api/executions?limit=1");
    assert.equal(firstPage.body.executions.length, 1);
    assert.equal(firstPage.body.hasMore, true);
    assert.equal(firstPage.body.nextOffset, 1);
    const secondPage = await client.get<{
      executions: { id: string }[];
      hasMore: boolean;
    }>("/api/executions?limit=1&offset=1");
    assert.notEqual(
      secondPage.body.executions[0]?.id,
      firstPage.body.executions[0]?.id,
    );
    assert.equal(secondPage.body.hasMore, false);

    const badStatus = await client.get("/api/executions?status=bogus");
    assert.equal(badStatus.status, 400);
    const badWorkflow = await client.get(
      "/api/executions?workflowKey=bogus",
    );
    assert.equal(badWorkflow.status, 400);
    assert.equal((await client.get("/api/executions?limit=101")).status, 400);
    assert.equal((await client.get("/api/executions?offset=-1")).status, 400);
  });
});

test("detail exposes input, steps and audit", async () => {
  await withStudio(async (client) => {
    const executionId = await startWorkflow(client, "processOrder", {
      orderId: "ORD-D",
      customerId: "C",
      amount: 2,
      processingDelayMs: 100,
    });
    await waitForNodeState(
      client,
      executionId,
      "__signal:awaitPaymentConfirmation",
      "waiting",
    );
    const detail = await getDetail(client, executionId);
    assert.deepEqual(detail.input, {
      orderId: "ORD-D",
      customerId: "C",
      amount: 2,
      processingDelayMs: 100,
    });
    assert.ok(
      detail.steps.some((step) => step.stepId === "validateOrder"),
      "validate step persisted",
    );
    assert.ok(
      detail.audit.some((entry) => entry.kind === "signal_waiting"),
      "signal wait audited",
    );
    assert.ok(detail.edges.length > 0, "edges included for graph rendering");
  });
});
