import test from "node:test";
import assert from "node:assert/strict";
import { createTestStudio, getDetail } from "./studio.test-support.js";

test("Studio reports an active continuation tip and rejects source restart", async () => {
  const client = await createTestStudio();
  try {
    const now = new Date();
    const base = {
      workflowKey: "processOrder",
      input: { orderId: "ORD-CONT", customerId: "C", amount: 3 },
      attempt: 1,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
    };
    await client.handles.store.saveExecution({
      ...base,
      id: "continued-root",
      status: "continued_as_new",
      continuedAsExecutionId: "continued-tip",
    });
    await client.handles.store.saveExecution({
      ...base,
      id: "continued-tip",
      status: "sleeping",
      continuedFromExecutionId: "continued-root",
    });

    const detail = await getDetail(client, "continued-root");
    assert.equal(detail.continuedChainTipStatus, "sleeping");
    const response = await client.post("/api/executions/continued-root/restart");
    assert.equal(response.status, 409);
    assert.equal(
      (await client.handles.store.getExecution("continued-root"))
        ?.restartedAsExecutionId,
      undefined,
    );

    await client.handles.store.updateExecution("continued-tip", {
      status: "paused",
      pausedFrom: "sleeping",
    });
    assert.equal((await getDetail(client, "continued-root")).continuedChainTipStatus, "paused");
    assert.equal(
      (await client.post("/api/executions/continued-root/restart")).status,
      202,
    );
    assert.equal(
      (await client.post("/api/executions/continued-tip/resume")).status,
      409,
    );
  } finally {
    await client.dispose();
  }
});
