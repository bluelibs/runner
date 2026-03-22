import {
  getExecutionWaitLockResource,
  getExecutionWaiterKey,
  withExecutionWaitLock,
} from "../../durable/core/executionWaiters";

describe("durable: execution waiters helpers", () => {
  it("builds deterministic waiter keys", () => {
    expect(getExecutionWaitLockResource("child")).toBe("execution_wait:child");
    expect(
      getExecutionWaiterKey({
        executionId: "parent",
        stepId: "__execution:child",
      }),
    ).toBe("parent:__execution:child");
  });

  it("throws when execution wait locks cannot be acquired", async () => {
    const store = {
      acquireLock: jest.fn().mockResolvedValue(null),
      releaseLock: jest.fn(),
    };

    await expect(
      withExecutionWaitLock({
        store: store as any,
        targetExecutionId: "child",
        fn: async () => "ok",
      }),
    ).rejects.toThrow("Failed to acquire execution wait lock");
  });

  it("executes the callback when locking is unavailable in the store", async () => {
    await expect(
      withExecutionWaitLock({
        store: {} as any,
        targetExecutionId: "child",
        fn: async () => "ok",
      }),
    ).resolves.toBe("ok");
  });
});
