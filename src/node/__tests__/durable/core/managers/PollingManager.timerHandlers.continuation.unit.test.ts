import { handleExecutionWaitTimeoutTimer } from "../../../../durable/core/managers/PollingManager.timerHandlers";
import {
  ExecutionStatus,
  TimerType,
  type Execution,
} from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";

function waitingParent(): Execution {
  return {
    id: "wait-exec",
    workflowKey: "t",
    input: undefined,
    status: ExecutionStatus.Sleeping,
    current: {
      kind: "waitForExecution",
      stepId: "__execution:child",
      startedAt: new Date(),
      waitingFor: {
        type: "execution",
        params: {
          targetExecutionId: "child",
          targetWorkflowKey: "canonical.child",
          timerId: "execution_timeout:wait-exec:__execution:child",
        },
      },
    },
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function continuedChild(next?: string): Execution {
  return {
    id: "child",
    workflowKey: "canonical.child",
    input: undefined,
    status: ExecutionStatus.ContinuedAsNew,
    continuedAsExecutionId: next,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function seedWaitingParent(store: MemoryStore): Promise<void> {
  await store.saveExecution(waitingParent());
  await store.saveStepResult({
    executionId: "wait-exec",
    stepId: "__execution:child",
    result: {
      state: "waiting",
      targetExecutionId: "child",
      timerId: "execution_timeout:wait-exec:__execution:child",
      timeoutAtMs: Date.now() + 1000,
    },
    completedAt: new Date(),
  });
}

async function seedContinuedParent(store: MemoryStore): Promise<void> {
  await store.saveExecution(waitingParent());
  await store.saveStepResult({
    executionId: "wait-exec",
    stepId: "__execution:child",
    result: {
      state: "continued",
      targetExecutionId: "child",
      continuedAsExecutionId: "tip",
      workflowKey: "canonical.child",
      timerId: "execution_timeout:wait-exec:__execution:child",
      timeoutAtMs: Date.now() - 1,
    },
    completedAt: new Date(),
  });
}

function timeoutTimer() {
  return {
    id: "execution_timeout:wait-exec:__execution:child",
    type: TimerType.Timeout,
    executionId: "wait-exec",
    stepId: "__execution:child",
    fireAt: new Date(),
    status: "pending" as const,
  };
}

describe("durable: execution-wait timeout continuation", () => {
  it("resolves against a tip that genuinely completed", async () => {
    const store = new MemoryStore();
    await seedWaitingParent(store);
    await store.saveExecution(continuedChild("tip"));
    await store.saveExecution({
      id: "tip",
      workflowKey: "canonical.child",
      input: undefined,
      status: ExecutionStatus.Completed,
      result: { ok: true },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.upsertExecutionWaiter({
      executionId: "wait-exec",
      targetExecutionId: "tip",
      stepId: "__execution:child",
    });

    await expect(
      handleExecutionWaitTimeoutTimer({ store, timer: timeoutTimer() }),
    ).resolves.toBe(true);

    expect(await store.getStepResult("wait-exec", "__execution:child")).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          state: "completed",
          targetExecutionId: "child",
          result: { ok: true },
        }),
      }),
    );
    expect(await store.listExecutionWaiters("tip")).toEqual([]);
    expect((await store.getExecution("wait-exec"))?.current).toBeUndefined();
  });

  it("times out against a live tip instead of following forever", async () => {
    const store = new MemoryStore();
    await seedWaitingParent(store);
    await store.saveExecution(continuedChild("tip"));
    await store.saveExecution({
      id: "tip",
      workflowKey: "canonical.child",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.upsertExecutionWaiter({
      executionId: "wait-exec",
      targetExecutionId: "tip",
      stepId: "__execution:child",
    });

    await expect(
      handleExecutionWaitTimeoutTimer({ store, timer: timeoutTimer() }),
    ).resolves.toBe(true);

    expect(await store.getStepResult("wait-exec", "__execution:child")).toEqual(
      expect.objectContaining({
        result: { state: "timed_out", targetExecutionId: "child" },
      }),
    );
  });

  it("times out after replay has persisted a continuation marker", async () => {
    const store = new MemoryStore();
    await seedContinuedParent(store);
    await store.saveExecution(continuedChild("tip"));
    await store.saveExecution({
      id: "tip",
      workflowKey: "canonical.child",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.upsertExecutionWaiter({
      executionId: "wait-exec",
      targetExecutionId: "tip",
      stepId: "__execution:child",
    });

    await expect(
      handleExecutionWaitTimeoutTimer({ store, timer: timeoutTimer() }),
    ).resolves.toBe(true);

    expect(await store.getStepResult("wait-exec", "__execution:child")).toEqual(
      expect.objectContaining({
        result: { state: "timed_out", targetExecutionId: "child" },
      }),
    );
  });

  it("times out when the chain link is broken", async () => {
    const store = new MemoryStore();
    await seedWaitingParent(store);
    await store.saveExecution(continuedChild(undefined));

    await expect(
      handleExecutionWaitTimeoutTimer({ store, timer: timeoutTimer() }),
    ).resolves.toBe(true);

    expect(await store.getStepResult("wait-exec", "__execution:child")).toEqual(
      expect.objectContaining({
        result: { state: "timed_out", targetExecutionId: "child" },
      }),
    );
  });

  it("times out when the successor record is missing", async () => {
    const store = new MemoryStore();
    await seedWaitingParent(store);
    await store.saveExecution(continuedChild("ghost"));

    await expect(
      handleExecutionWaitTimeoutTimer({ store, timer: timeoutTimer() }),
    ).resolves.toBe(true);

    expect(await store.getStepResult("wait-exec", "__execution:child")).toEqual(
      expect.objectContaining({
        result: { state: "timed_out", targetExecutionId: "child" },
      }),
    );
  });

  it("fails fast on a cyclic chain", async () => {
    const store = new MemoryStore();
    await seedWaitingParent(store);
    await store.saveExecution(continuedChild("child"));

    await expect(
      handleExecutionWaitTimeoutTimer({ store, timer: timeoutTimer() }),
    ).rejects.toThrow(
      "Continuation chain for execution 'child' is cyclic at 'child'.",
    );
  });
});
