import test from "node:test";
import assert from "node:assert/strict";
import { dispatchApiRequest } from "./server/http.js";
import {
  createTestStudio,
  getDetail,
  startWorkflow,
  waitForNodeState,
  waitForStatus,
  waitUntil,
  type StudioExecutionSummary,
  type StudioSchedule,
  type StudioTestClient,
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

test("chaos incident fails inside the ack branch and retries re-run it", async () => {
  await withStudio(async (client) => {
    const executionId = await startWorkflow(client, "incidentResponse", {
      incidentId: "INC-CHAOS",
      severity: "SEV-1",
      summary: "drill",
      chaos: true,
      ackTimeoutMs: 30_000,
      approvalTimeoutMs: 30_000,
    });
    await waitForNodeState(client, executionId, "__signal:awaitAck", "waiting");
    await client.post(`/api/executions/${executionId}/signals`, {
      signal: "incidentAcknowledged",
      payload: { acknowledgedBy: "ada", acknowledgedAt: Date.now() },
    });

    const failed = await waitForStatus(client, executionId, "failed");
    assert.match(failed.position ?? "", /diagnose/);
    assert.match(failed.position ?? "", /Runbook exploded/);
    assert.equal(
      failed.timeline.find((node) => node.id === "diagnose")?.state,
      "failed",
    );

    const retried = await client.post(`/api/executions/${executionId}/retry`);
    assert.equal(retried.status, 202);
    await waitUntil(
      async () =>
        (await getDetail(client, executionId)).updatedAt !== failed.updatedAt,
      { timeoutMs: 10_000, message: "retry to re-run the execution" },
    );
    const failedAgain = await waitForStatus(client, executionId, "failed");
    assert.match(failedAgain.position ?? "", /diagnose/);
  });
});

test("cancel parks a sleeping execution as cancelled", async () => {
  await withStudio(async (client) => {
    const executionId = await startWorkflow(client, "processOrder", {
      orderId: "ORD-C",
      customerId: "C",
      amount: 3,
      processingDelayMs: 30_000,
    });
    await waitForNodeState(
      client,
      executionId,
      "__sleep:processingDelay",
      "waiting",
    );

    const cancelled = await client.post(
      `/api/executions/${executionId}/cancel`,
    );
    assert.equal(cancelled.status, 202);
    const done = await waitForStatus(client, executionId, "cancelled");
    assert.equal(done.position, "Cancelled");

    const again = await client.post(`/api/executions/${executionId}/cancel`);
    assert.equal(again.status, 409);
  });
});

test("force-fail marks a waiting execution failed with the reason", async () => {
  await withStudio(async (client) => {
    const executionId = await startWorkflow(client, "userOnboarding", {
      email: "ff@example.com",
      plan: "pro",
      verificationTimeoutMs: 30_000,
    });
    await waitForNodeState(
      client,
      executionId,
      "__signal:awaitEmailVerification",
      "waiting",
    );

    const noReason = await client.post(
      `/api/executions/${executionId}/force-fail`,
      {},
    );
    assert.equal(noReason.status, 400);

    const failed = await client.post(
      `/api/executions/${executionId}/force-fail`,
      { reason: "operator drill" },
    );
    assert.equal(failed.status, 202);
    const detail = await waitForStatus(client, executionId, "failed");
    assert.match(detail.error?.message ?? "", /operator drill/);

    const terminal = await client.post(
      `/api/executions/${executionId}/force-fail`,
      { reason: "again" },
    );
    assert.equal(terminal.status, 409);
  });
});

test("operators can edit and skip steps with an audited reason", async () => {
  await withStudio(async (client) => {
    const executionId = await startWorkflow(client, "userOnboarding", {
      email: "repair@example.com",
      plan: "pro",
      verificationTimeoutMs: 30_000,
    });
    await waitForNodeState(
      client,
      executionId,
      "__signal:awaitEmailVerification",
      "waiting",
    );

    assert.equal(
      (
        await client.post(`/api/executions/${executionId}/edit-state`, {
          stepId: "createAccount",
          reason: "Corrected imported account identity",
          result: {
            userId: "user_repaired",
            email: "repair@example.com",
            plan: "pro",
          },
        })
      ).status,
      202,
    );
    assert.equal(
      (
        await client.post(`/api/executions/${executionId}/skip-step`, {
          stepId: "sendWelcomeEmail",
          reason: "Message was already sent manually",
        })
      ).status,
      202,
    );

    const detail = await getDetail(client, executionId);
    assert.deepEqual(
      detail.steps.find((step) => step.stepId === "createAccount")?.result,
      {
        userId: "user_repaired",
        email: "repair@example.com",
        plan: "pro",
      },
    );
    assert.deepEqual(
      detail.steps.find((step) => step.stepId === "sendWelcomeEmail")?.result,
      { skipped: true, manual: true },
    );
    const operatorNotes = detail.audit.filter(
      (entry) =>
        entry.kind === "note" &&
        typeof entry.detail.message === "string" &&
        entry.detail.message.startsWith("Operator"),
    );
    assert.equal(operatorNotes.length, 2);

    assert.equal(
      (
        await client.post(`/api/executions/${executionId}/edit-state`, {
          stepId: "createAccount",
          reason: "Missing replacement",
        })
      ).status,
      400,
    );
  });
});

test("terminal executions reject signals, cancel and retry", async () => {
  await withStudio(async (client) => {
    const executionId = await startWorkflow(client, "userOnboarding", {
      email: "t@example.com",
      plan: "free",
      verificationTimeoutMs: 200,
    });
    await waitForStatus(client, executionId, "completed");

    const signalled = await client.post(
      `/api/executions/${executionId}/signals`,
      { signal: "emailVerified", payload: { verifiedAt: Date.now() } },
    );
    assert.equal(signalled.status, 409);
    const cancelled = await client.post(
      `/api/executions/${executionId}/cancel`,
    );
    assert.equal(cancelled.status, 409);
    const retried = await client.post(`/api/executions/${executionId}/retry`);
    assert.equal(retried.status, 409);
  });
});

test("unknown ids and payloads are rejected", async () => {
  await withStudio(async (client) => {
    assert.equal(
      (await client.get("/api/executions/nope")).status,
      404,
    );
    assert.equal(
      (await client.post("/api/executions/nope/signals", {})).status,
      400,
    );
    assert.equal(
      (
        await client.post("/api/executions/nope/signals", {
          signal: "emailVerified",
          payload: {},
        })
      ).status,
      404,
    );
    assert.equal(
      (await client.post("/api/executions/nope/cancel")).status,
      404,
    );
    assert.equal((await client.post("/api/executions/nope/retry")).status, 404);
    assert.equal(
      (await client.post("/api/executions", { workflow: "nope" })).status,
      400,
    );
    assert.equal(
      (await client.get("/api/executions?cursor=!!!not-a-cursor")).status,
      400,
    );
    assert.equal((await client.post("/api/executions", null)).status, 400);
    assert.equal(
      (await client.post("/api/schedules/nope/pause")).status,
      404,
    );
    assert.equal(
      (await client.delete("/api/schedules/nope")).status,
      404,
    );
    assert.equal(
      (await client.patch("/api/schedules/nope", { interval: 1000 })).status,
      404,
    );
    assert.equal((await client.get("/api/bogus")).status, 404);
  });
});

test("runtime schemas reject malformed workflow inputs and signal payloads", async () => {
  await withStudio(async (client) => {
    const invalidStart = await client.post<{ error: string }>(
      "/api/executions",
      {
        workflow: "processOrder",
        input: { orderId: "", customerId: "CUST-7", amount: -5 },
      },
    );
    assert.equal(invalidStart.status, 400);
    assert.match(invalidStart.body.error, /orderId|amount/);

    const invalidSchedule = await client.post<{ error: string }>(
      "/api/schedules",
      {
        workflow: "userOnboarding",
        input: { email: "not-an-email", plan: "enterprise" },
        interval: 60_000,
      },
    );
    assert.equal(invalidSchedule.status, 400);
    assert.match(invalidSchedule.body.error, /email|plan/);

    const executionId = await startWorkflow(client, "processOrder", {
      orderId: "ORD-SCHEMA",
      customerId: "CUST-7",
      amount: 42,
      processingDelayMs: 0,
    });
    await waitForNodeState(
      client,
      executionId,
      "__signal:awaitPaymentConfirmation",
      "waiting",
    );

    const invalidSignal = await client.post<{ error: string }>(
      `/api/executions/${executionId}/signals`,
      {
        signal: "paymentConfirmed",
        payload: { transactionId: 42 },
      },
    );
    assert.equal(invalidSignal.status, 400);
    assert.match(invalidSignal.body.error, /transactionId/);
    assert.deepEqual((await getDetail(client, executionId)).signals, []);

    const validSignal = await client.post(
      `/api/executions/${executionId}/signals`,
      {
        signal: "paymentConfirmed",
        payload: { transactionId: "txn_schema" },
      },
    );
    assert.equal(validSignal.status, 202);
    await waitForStatus(client, executionId, "completed");
  });
});

test("schedules edit, pause, resume and delete", async () => {
  await withStudio(async (client) => {
    const created = await client.post<{ scheduleId: string }>("/api/schedules", {
      workflow: "userOnboarding",
      input: { email: "s@example.com", plan: "free" },
      id: "nightly-onboarding",
      interval: 3_600_000,
    });
    assert.equal(created.status, 201);

    const listed = await client.get<{ schedules: StudioSchedule[] }>(
      "/api/schedules",
    );
    assert.equal(listed.status, 200);
    assert.equal(listed.body.schedules.length, 1);
    assert.equal(listed.body.schedules[0]!.status, "active");

    assert.equal(
      (
        await client.patch("/api/schedules/nightly-onboarding", {
          input: { email: "not-an-email", plan: "enterprise" },
        })
      ).status,
      400,
    );

    assert.equal(
      (
        await client.patch("/api/schedules/nightly-onboarding", {
          interval: 7_200_000,
          input: { email: "updated@example.com", plan: "pro" },
        })
      ).status,
      202,
    );
    const edited = await client.get<{ schedules: StudioSchedule[] }>(
      "/api/schedules",
    );
    assert.equal(edited.body.schedules[0]!.pattern, "7200000");
    assert.deepEqual(edited.body.schedules[0]!.input, {
      email: "updated@example.com",
      plan: "pro",
    });

    assert.equal(
      (await client.post("/api/schedules/nightly-onboarding/pause")).status,
      202,
    );
    const paused = await client.get<{ schedules: StudioSchedule[] }>(
      "/api/schedules",
    );
    assert.equal(paused.body.schedules[0]!.status, "paused");

    assert.equal(
      (await client.post("/api/schedules/nightly-onboarding/resume")).status,
      202,
    );
    assert.equal(
      (await client.delete("/api/schedules/nightly-onboarding")).status,
      202,
    );
    const empty = await client.get<{ schedules: StudioSchedule[] }>(
      "/api/schedules",
    );
    assert.equal(empty.body.schedules.length, 0);
  });
});

test("one-time schedules fire executions", async () => {
  await withStudio(async (client) => {
    const created = await client.post<{ scheduleId: string }>("/api/schedules", {
      workflow: "userOnboarding",
      input: {
        email: "scheduled@example.com",
        plan: "free",
        verificationTimeoutMs: 300,
      },
      delay: 300,
    });
    assert.equal(created.status, 201);

    let ids: string[] = [];
    await waitUntil(
      async () => {
        const listed = await client.get<{
          executions: StudioExecutionSummary[];
        }>("/api/executions?workflowKey=userOnboarding");
        ids = listed.body.executions.map((execution) => execution.id);
        return ids.length > 0;
      },
      { timeoutMs: 15_000, message: "scheduled execution to start" },
    );
    const done = await waitForStatus(client, ids[0]!, "completed", 20_000);
    assert.equal((done.result as { verified: boolean }).verified, false);
  });
});

test("execution detail exposes child relationships and loop iterations", async () => {
  await withStudio(async (client) => {
    const parentId = await startWorkflow(client, "portfolioReconciliation", {
      portfolioId: "PORT-TEST",
      ordersPerBatch: 10,
    });
    const parent = await waitForStatus(client, parentId, "completed", 20_000);

    assert.equal(parent.relations.children.length, 3);
    assert.equal(
      (parent.result as { ordersProcessed: number }).ordersProcessed,
      90,
    );
    const child = await getDetail(client, parent.relations.children[0]!.id);
    assert.equal(child.relations.parent?.id, parentId);
    const loopNodes = child.timeline.filter((node) =>
      node.id.startsWith("processBatch:"),
    );
    assert.equal(loopNodes.length, 3);
    assert.deepEqual(
      loopNodes.map((node) => node.state),
      ["completed", "completed", "completed"],
    );
    assert.equal(
      child.timeline.filter((node) => node.kind === "note").length,
      3,
    );
  });
});

test("execution detail exposes queued and consumed signal history", async () => {
  await withStudio(async (client) => {
    const executionId = await startWorkflow(client, "processOrder", {
      orderId: "ORD-SIGNALS",
      customerId: "C",
      amount: 5,
      processingDelayMs: 1,
    });
    await waitForNodeState(
      client,
      executionId,
      "__signal:awaitPaymentConfirmation",
      "waiting",
    );
    await client.post(`/api/executions/${executionId}/signals`, {
      signal: "paymentConfirmed",
      payload: { transactionId: "txn_test" },
    });
    const completed = await waitForStatus(client, executionId, "completed");

    assert.equal(completed.signals.length, 1);
    assert.equal(completed.signals[0]!.signalId, "paymentConfirmed");
    assert.equal(completed.signals[0]!.history[0]!.state, "consumed");
  });
});

test("schedule validation rejects bad cadences", async () => {
  await withStudio(async (client) => {
    const preview = await client.post<{ fires: string[] }>(
      "/api/schedules/preview",
      { cron: "0 * * * *", timezone: "UTC" },
    );
    assert.equal(preview.status, 200);
    assert.equal(preview.body.fires.length, 3);
    assert.ok(
      preview.body.fires.every((fire) => !Number.isNaN(Date.parse(fire))),
    );
    assert.equal(
      (await client.post("/api/schedules/preview", { interval: -1 })).status,
      400,
    );

    const both = await client.post("/api/schedules", {
      workflow: "processOrder",
      input: {},
      cron: "* * * * *",
      interval: 1000,
    });
    assert.equal(both.status, 400);
    const oneTimeWithId = await client.post("/api/schedules", {
      workflow: "processOrder",
      input: {},
      id: "once",
      delay: 1000,
    });
    assert.equal(oneTimeWithId.status, 400);
    const unknown = await client.post("/api/schedules", {
      workflow: "nope",
      input: {},
      interval: 1000,
    });
    assert.equal(unknown.status, 400);
  });
});

test("stuck list and recovery report are served", async () => {
  await withStudio(async (client) => {
    const stuck = await client.get<{ executions: StudioExecutionSummary[] }>(
      "/api/stuck",
    );
    assert.equal(stuck.status, 200);
    assert.deepEqual(stuck.body.executions, []);

    const recovered = await client.post<{
      report: { scannedCount: number };
    }>("/api/recover");
    assert.equal(recovered.status, 202);
    assert.ok(recovered.body.report.scannedCount >= 0);
  });
});

test("pause and resume park a waiting execution without losing it", async () => {
  await withStudio(async (client) => {
    const executionId = await startWorkflow(client, "processOrder", {
      orderId: "ORD-PAUSE",
      customerId: "C",
      amount: 3,
      processingDelayMs: 30_000,
    });
    await waitForNodeState(
      client,
      executionId,
      "__sleep:processingDelay",
      "waiting",
    );

    const paused = await client.post(`/api/executions/${executionId}/pause`);
    assert.equal(paused.status, 202);
    const parked = await waitForStatus(client, executionId, "paused");
    assert.equal(parked.position, "Paused");
    assert.equal(parked.pausedFrom, "sleeping");
    assert.equal(parked.state, null);
    assert.ok(
      parked.audit.some(
        (entry) =>
          entry.kind === "note" &&
          entry.detail.message === "Operator paused execution",
      ),
    );

    assert.equal(
      (await client.post(`/api/executions/${executionId}/pause`)).status,
      409,
    );
    assert.equal(
      (await client.post(`/api/executions/${executionId}/restart`)).status,
      202,
    );

    const resumed = await client.post(`/api/executions/${executionId}/resume`);
    assert.equal(resumed.status, 202);
    const awake = await waitForStatus(client, executionId, "sleeping");
    assert.equal(awake.pausedFrom, undefined);
    assert.equal(
      (await client.post(`/api/executions/${executionId}/resume`)).status,
      409,
    );

    const cancelled = await client.post(
      `/api/executions/${executionId}/cancel`,
    );
    assert.equal(cancelled.status, 202);
    await waitForStatus(client, executionId, "cancelled");
  });
});

test("restart re-runs terminal executions and links lineage", async () => {
  await withStudio(async (client) => {
    const executionId = await startWorkflow(client, "userOnboarding", {
      email: "restart@example.com",
      plan: "free",
      verificationTimeoutMs: 200,
    });
    await waitForStatus(client, executionId, "completed");

    assert.equal(
      (await client.post(`/api/executions/${executionId}/pause`)).status,
      409,
    );
    assert.equal(
      (await client.post(`/api/executions/${executionId}/resume`)).status,
      409,
    );

    const restarted = await client.post<{ executionId: string }>(
      `/api/executions/${executionId}/restart`,
    );
    assert.equal(restarted.status, 202);
    const nextId = restarted.body.executionId;
    assert.ok(nextId.length > 0);
    assert.notEqual(nextId, executionId);

    const source = await getDetail(client, executionId);
    assert.equal(source.restartedAsExecutionId, nextId);
    const next = await getDetail(client, nextId);
    assert.equal(next.restartedFromExecutionId, executionId);
    assert.equal(next.state, null);
    await waitForStatus(client, nextId, "completed");

    const live = await startWorkflow(client, "processOrder", {
      orderId: "ORD-NO-RESTART",
      customerId: "C",
      amount: 3,
      processingDelayMs: 30_000,
    });
    await waitForNodeState(
      client,
      live,
      "__sleep:processingDelay",
      "waiting",
    );
    assert.equal(
      (await client.post(`/api/executions/${live}/restart`)).status,
      409,
    );

    assert.equal(
      (
        await client.post(`/api/executions/${executionId}/restart`, {
          input: { email: "not-an-email", plan: "enterprise" },
        })
      ).status,
      400,
    );
    assert.equal(
      (await client.post("/api/executions/nope/pause")).status,
      404,
    );
    assert.equal(
      (await client.post("/api/executions/nope/resume")).status,
      404,
    );
    assert.equal(
      (await client.post("/api/executions/nope/restart")).status,
      404,
    );
  });
});

test("stream route resolves to a server-sent stream", async () => {
  await withStudio(async (client) => {
    const dispatched = await dispatchApiRequest(
      client.handles,
      "GET",
      new URL("/api/executions/exec_1/stream", "http://studio.local"),
      undefined,
    );
    assert.equal(dispatched.kind, "stream");
    if (dispatched.kind === "stream") {
      assert.equal(dispatched.executionId, "exec_1");
    }
  });
});
