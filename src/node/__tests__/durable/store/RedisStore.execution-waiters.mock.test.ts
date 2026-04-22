import {
  serializer,
  setupRedisStoreMock,
} from "../helpers/RedisStore.mock.helpers";

const harness = setupRedisStoreMock();

describe("durable: RedisStore execution waiters (mock)", () => {
  it("stores, lists, and deletes execution waiters", async () => {
    const { redisMock, store } = harness;
    const waiter = {
      executionId: "parent/1",
      targetExecutionId: "child/with spaces",
      stepId: "__execution:child-step",
      timerId: "timer-1",
    };

    await expect(store.upsertExecutionWaiter(waiter)).resolves.toBeUndefined();
    expect(redisMock.hset).toHaveBeenCalledWith(
      "durable:execution_waiters:child%2Fwith%20spaces",
      "parent/1:__execution:child-step",
      serializer.stringify(waiter),
    );

    redisMock.hgetall.mockResolvedValueOnce({
      a: serializer.stringify(waiter),
    });
    await expect(
      store.listExecutionWaiters("child/with spaces"),
    ).resolves.toEqual([waiter]);

    await expect(
      store.deleteExecutionWaiter(
        "child/with spaces",
        "parent/1",
        "__execution:child-step",
      ),
    ).resolves.toBeUndefined();
    expect(redisMock.hdel).toHaveBeenCalledWith(
      "durable:execution_waiters:child%2Fwith%20spaces",
      "parent/1:__execution:child-step",
    );
  });

  it("commits execution waiter completions atomically and surfaces store-shape errors", async () => {
    const { redisMock, store } = harness;
    redisMock.eval.mockResolvedValueOnce(1 as any);

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
        timerId: "timer-1",
      }),
    ).resolves.toBe(true);

    redisMock.eval.mockResolvedValueOnce(0 as any);
    await expect(
      store.commitExecutionWaiterCompletion({
        targetExecutionId: "child",
        executionId: "parent",
        stepId: "__execution:child-step",
        stepResult: {
          executionId: "parent",
          stepId: "__execution:child-step",
          result: { state: "completed", targetExecutionId: "child", result: 2 },
          completedAt: new Date(),
        },
      }),
    ).resolves.toBe(false);

    redisMock.eval.mockResolvedValueOnce(
      "__error__:Invalid execution waiter completion payload" as any,
    );
    await expect(
      store.commitExecutionWaiterCompletion({
        targetExecutionId: "child",
        executionId: "parent",
        stepId: "__execution:child-step",
        stepResult: {
          executionId: "parent",
          stepId: "__execution:child-step",
          result: { state: "completed", targetExecutionId: "child", result: 3 },
          completedAt: new Date(),
        },
      }),
    ).rejects.toThrow("Invalid execution waiter completion payload");
  });
});
