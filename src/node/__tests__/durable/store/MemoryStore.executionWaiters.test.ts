import { TimerStatus, TimerType } from "../../../durable/core/types";
import { MemoryStore } from "../../../durable/store/MemoryStore";

describe("durable: MemoryStore execution waiters", () => {
  it("returns false when completion cannot find waiter, step, or waiting state", async () => {
    const store = new MemoryStore();

    await expect(
      store.commitExecutionWaiterCompletion({
        targetExecutionId: "child",
        executionId: "parent",
        stepId: "__execution:child-step",
        stepResult: {
          executionId: "parent",
          stepId: "__execution:child-step",
          result: { state: "completed", targetExecutionId: "child", result: 1 },
          completedAt: new Date(),
        },
      }),
    ).resolves.toBe(false);

    await store.upsertExecutionWaiter({
      targetExecutionId: "child",
      executionId: "parent",
      stepId: "__execution:child-step",
    });
    await expect(
      store.commitExecutionWaiterCompletion({
        targetExecutionId: "child",
        executionId: "parent",
        stepId: "__execution:child-step",
        stepResult: {
          executionId: "parent",
          stepId: "__execution:child-step",
          result: { state: "completed", targetExecutionId: "child", result: 1 },
          completedAt: new Date(),
        },
      }),
    ).resolves.toBe(false);

    await store.saveStepResult({
      executionId: "parent",
      stepId: "__execution:child-step",
      result: { state: "waiting", targetExecutionId: "other-child" },
      completedAt: new Date(),
    });
    await expect(
      store.commitExecutionWaiterCompletion({
        targetExecutionId: "child",
        executionId: "parent",
        stepId: "__execution:child-step",
        stepResult: {
          executionId: "parent",
          stepId: "__execution:child-step",
          result: { state: "completed", targetExecutionId: "child", result: 1 },
          completedAt: new Date(),
        },
      }),
    ).resolves.toBe(false);
  });

  it("commits waiter completion, removes timers, and tolerates missing waiter buckets", async () => {
    const store = new MemoryStore();

    await store.upsertExecutionWaiter({
      targetExecutionId: "child",
      executionId: "parent",
      stepId: "__execution:child-step",
      timerId: "timer-1",
    });
    await store.saveStepResult({
      executionId: "parent",
      stepId: "__execution:child-step",
      result: { state: "waiting", targetExecutionId: "child" },
      completedAt: new Date(),
    });
    await store.createTimer({
      id: "timer-1",
      executionId: "parent",
      stepId: "__execution:child-step",
      type: TimerType.Timeout,
      fireAt: new Date(),
      status: TimerStatus.Pending,
    });

    await expect(
      store.commitExecutionWaiterCompletion({
        targetExecutionId: "child",
        executionId: "parent",
        stepId: "__execution:child-step",
        stepResult: {
          executionId: "parent",
          stepId: "__execution:child-step",
          result: { state: "completed", targetExecutionId: "child", result: 7 },
          completedAt: new Date(),
        },
        timerId: "timer-1",
      }),
    ).resolves.toBe(true);

    await expect(store.listExecutionWaiters("child")).resolves.toEqual([]);
    await expect(
      store.getReadyTimers(new Date(Date.now() + 1_000)),
    ).resolves.toEqual([]);

    await expect(
      store.deleteExecutionWaiter(
        "missing",
        "parent",
        "__execution:child-step",
      ),
    ).resolves.toBeUndefined();
  });

  it("keeps waiter buckets until the last waiter is removed", async () => {
    const store = new MemoryStore();

    await store.upsertExecutionWaiter({
      targetExecutionId: "child",
      executionId: "parent-a",
      stepId: "__execution:child-step-a",
    });
    await store.upsertExecutionWaiter({
      targetExecutionId: "child",
      executionId: "parent-b",
      stepId: "__execution:child-step-b",
    });
    await store.saveStepResult({
      executionId: "parent-a",
      stepId: "__execution:child-step-a",
      result: { state: "waiting", targetExecutionId: "child" },
      completedAt: new Date(),
    });

    await expect(
      store.commitExecutionWaiterCompletion({
        targetExecutionId: "child",
        executionId: "parent-a",
        stepId: "__execution:child-step-a",
        stepResult: {
          executionId: "parent-a",
          stepId: "__execution:child-step-a",
          result: { state: "completed", targetExecutionId: "child", result: 1 },
          completedAt: new Date(),
        },
      }),
    ).resolves.toBe(true);

    await expect(store.listExecutionWaiters("child")).resolves.toEqual([
      expect.objectContaining({
        executionId: "parent-b",
        stepId: "__execution:child-step-b",
      }),
    ]);

    await expect(
      store.deleteExecutionWaiter(
        "child",
        "parent-b",
        "__execution:child-step-b",
      ),
    ).resolves.toBeUndefined();
    await expect(store.listExecutionWaiters("child")).resolves.toEqual([]);
  });

  it("removes a single waiter without dropping the whole bucket", async () => {
    const store = new MemoryStore();

    await store.upsertExecutionWaiter({
      targetExecutionId: "child",
      executionId: "parent-a",
      stepId: "__execution:child-step-a",
    });
    await store.upsertExecutionWaiter({
      targetExecutionId: "child",
      executionId: "parent-b",
      stepId: "__execution:child-step-b",
    });

    await expect(
      store.deleteExecutionWaiter(
        "child",
        "parent-a",
        "__execution:child-step-a",
      ),
    ).resolves.toBeUndefined();
    await expect(
      store.deleteExecutionWaiter(
        "child",
        "parent-missing",
        "__execution:child-step-missing",
      ),
    ).resolves.toBeUndefined();
    await expect(store.listExecutionWaiters("child")).resolves.toEqual([
      expect.objectContaining({
        executionId: "parent-b",
        stepId: "__execution:child-step-b",
      }),
    ]);
  });

  it("handles timer bookkeeping edges for missing timers and stale claims", async () => {
    const store = new MemoryStore();

    await expect(
      store.markTimerFired("missing-timer"),
    ).resolves.toBeUndefined();

    await expect(
      store.finalizeClaimedTimer("missing-timer", "worker-1"),
    ).resolves.toBe(false);
  });
});
