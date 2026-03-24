import { defineEvent, r, resources, run } from "../../node";
import { ExecutionStatus } from "../../durable/core/types";
import { createDurableTestSetup, waitUntil } from "../../durable/test-utils";

const Paid = defineEvent<{ paidAt: number }>({
  id: "durable-test-idempotent-signal-paid",
});

describe("durable: idempotent start safe default", () => {
  it("does not replay sleeping executions on repeated idempotent start", async () => {
    const { durable, durableRegistration, store } = createDurableTestSetup({
      durableId: "durable-test-idempotent-sleep",
    });

    let taskRuns = 0;
    const task = r
      .task("durable-test-idempotent-sleep")
      .dependencies({ durable })
      .run(async (_input: unknown, { durable }) => {
        taskRuns += 1;
        const ctx = durable.use();
        await ctx.sleep(100, { stepId: "sleep" });
        return "done";
      })
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const firstExecutionId = await service.start(task, undefined, {
      idempotencyKey: "idempotency-key:two",
    });

    await waitUntil(
      async () =>
        (await store.getExecution(firstExecutionId))?.status ===
        ExecutionStatus.Sleeping,
      { timeoutMs: 1_000, intervalMs: 5 },
    );

    const secondExecutionId = await service.start(task, undefined, {
      idempotencyKey: "idempotency-key:two",
    });

    expect(secondExecutionId).toBe(firstExecutionId);
    expect(taskRuns).toBe(1);
    await expect(
      service.wait(firstExecutionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toBe("done");

    await runtime.dispose();
  });

  it("does not replay signal waits on repeated idempotent start", async () => {
    const { durable, durableRegistration, store } = createDurableTestSetup({
      durableId: "durable-test-idempotent-signal",
    });

    let taskRuns = 0;
    const task = r
      .task("durable-test-idempotent-signal")
      .dependencies({ durable })
      .run(async (_input: unknown, { durable }) => {
        taskRuns += 1;
        const ctx = durable.use();
        const payment = await ctx.waitForSignal(Paid, {
          stepId: "wait-for-signal",
        });

        if (payment.kind === "timeout") {
          return { ok: false, paidAt: -1 };
        }

        return { ok: true, paidAt: payment.payload.paidAt };
      })
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const firstExecutionId = await service.start(task, undefined, {
      idempotencyKey: "idempotency-key:three",
      timeout: 5_000,
    });

    await waitUntil(
      async () =>
        (await store.getExecution(firstExecutionId))?.status ===
        ExecutionStatus.Sleeping,
      { timeoutMs: 1_000, intervalMs: 5 },
    );

    const secondExecutionId = await service.start(task, undefined, {
      idempotencyKey: "idempotency-key:three",
      timeout: 5_000,
    });

    expect(secondExecutionId).toBe(firstExecutionId);
    expect(taskRuns).toBe(1);

    await service.signal(firstExecutionId, Paid, { paidAt: 7 });
    await expect(
      service.wait(firstExecutionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toEqual({ ok: true, paidAt: 7 });

    await runtime.dispose();
  });
});
