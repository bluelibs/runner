import { r, resources, run } from "../../../../node";
import { durableResource } from "../../../../durable/core/resource";
import { ExecutionStatus } from "../../../../durable/core/types";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { MemoryQueue } from "../../../../durable/queue/MemoryQueue";
import { MemoryStore } from "../../../../durable/store/MemoryStore";

enum TaskId {
  IdempotentStart = "durable-test-idempotent-start",
  CancellableSleep = "durable-test-cancellable-sleep",
  CooperativeCancel = "durable-test-cooperative-cancel",
}

enum IdempotencyKey {
  One = "idempotency-key:one",
}

enum CancelReason {
  UserRequested = "user_requested",
}

enum StepId {
  Sleep = "sleep",
  CooperativeCancel = "cooperative-cancel",
}

enum ResultValue {
  Done = "done",
}

describe("durable: idempotency & cancellation (integration)", () => {
  it("dedupes start when idempotencyKey matches", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = durableResource.fork("durable-test-idempotency");
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      polling: { interval: 5 },
    });

    const task = r
      .task(TaskId.IdempotentStart)
      .dependencies({ durable })
      .run(async (input: { v: number }) => input)
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const firstExecutionId = await service.start(
      task,
      { v: 1 },
      { idempotencyKey: IdempotencyKey.One },
    );

    const secondExecutionId = await service.start(
      task,
      { v: 999 },
      { idempotencyKey: IdempotencyKey.One },
    );

    expect(secondExecutionId).toBe(firstExecutionId);

    const result = await service.wait<{ v: number }>(firstExecutionId, {
      timeout: 5_000,
      waitPollIntervalMs: 5,
    });

    expect(result).toEqual({ v: 1 });

    const exec = await store.getExecution(firstExecutionId);
    expect(exec?.input).toEqual({ v: 1 });

    await runtime.dispose();
  });
  it("cancels an execution and prevents later completion", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = durableResource.fork("durable-test-cancel");
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      polling: { interval: 5 },
    });

    const task = r
      .task(TaskId.CancellableSleep)
      .dependencies({ durable })
      .run(async (_input: unknown, { durable }) => {
        const ctx = durable.use();
        await ctx.sleep(50, { stepId: StepId.Sleep });
        return ResultValue.Done;
      })
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const executionId = await service.start(task);
    await service.cancelExecution(executionId, CancelReason.UserRequested);

    await expect(
      service.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).rejects.toThrow(CancelReason.UserRequested);

    await new Promise((resolve) => setTimeout(resolve, 150));

    const exec = await store.getExecution(executionId);
    expect(exec?.status).toBe(ExecutionStatus.Cancelled);

    await runtime.dispose();
  });

  it("signals running steps and skips retries after cancellation", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const queue = new MemoryQueue();

    const durable = durableResource.fork("durable-test-cooperative-worker");
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      queue,
      roles: { queueConsumer: true },
      polling: { interval: 5 },
    });

    let stepAttempts = 0;
    let observedAbort = false;
    let resolveStepStarted!: () => void;
    const stepStarted = new Promise<void>((resolve) => {
      resolveStepStarted = resolve;
    });

    const task = r
      .task(TaskId.CooperativeCancel)
      .dependencies({ durable })
      .run(async (_input: unknown, { durable }) => {
        const ctx = durable.use();
        return await ctx.step(
          StepId.CooperativeCancel,
          { retries: 3 },
          async ({ signal }) => {
            stepAttempts += 1;
            resolveStepStarted();
            await new Promise((resolve) => setTimeout(resolve, 50));
            observedAbort = signal.aborted;

            return ResultValue.Done;
          },
        );
      })
      .build();

    const workerApp = r
      .resource("app")
      .register([resources.durable, durableRegistration, task])
      .build();

    const runtime = await run(workerApp, {
      logs: { printThreshold: null },
    });
    const service = runtime.getResourceValue(durable);

    const executionId = await service.start(task);
    await stepStarted;

    await service.cancelExecution(executionId, CancelReason.UserRequested);

    await expect(
      service.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).rejects.toThrow(CancelReason.UserRequested);

    expect(observedAbort).toBe(true);
    expect(stepAttempts).toBe(1);
    await expect(
      store.getStepResult(executionId, StepId.CooperativeCancel),
    ).resolves.toBeNull();
    await expect(store.getExecution(executionId)).resolves.toEqual(
      expect.objectContaining({
        status: ExecutionStatus.Cancelled,
        error: { message: CancelReason.UserRequested },
      }),
    );

    await runtime.dispose();
  });
});
