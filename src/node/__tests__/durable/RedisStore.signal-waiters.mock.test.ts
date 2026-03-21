import { createSignalWaiterSortKey } from "../../durable/core/signalWaiters";
import { serializer, setupRedisStoreMock } from "./RedisStore.mock.helpers";

const harness = setupRedisStoreMock();

describe("durable: RedisStore signal waiters (mock)", () => {
  it("stores, peeks, takes, and deletes signal waiters atomically", async () => {
    const { redisMock, store } = harness;
    const waiter = {
      executionId: "e1",
      signalId: "paid/with spaces",
      stepId: "__signal:stable-paid",
      sortKey: createSignalWaiterSortKey(
        "paid/with spaces",
        "__signal:stable-paid",
      ),
      timerId: "timer-1",
    };

    await store.upsertSignalWaiter?.(waiter);
    redisMock.eval.mockResolvedValueOnce(serializer.stringify(waiter));
    await expect(
      store.takeNextSignalWaiter?.("e1", "paid/with spaces"),
    ).resolves.toEqual(waiter);
    redisMock.eval.mockResolvedValueOnce(null);
    await expect(
      store.takeNextSignalWaiter?.("e1", "paid/with spaces"),
    ).resolves.toBeNull();

    await store.deleteSignalWaiter?.(
      "e1",
      "paid/with spaces",
      "__signal:stable-paid",
    );

    const peekWaiter = {
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    };
    redisMock.eval.mockResolvedValueOnce(serializer.stringify(peekWaiter));
    await expect(store.peekNextSignalWaiter("e1", "paid")).resolves.toEqual(
      peekWaiter,
    );
  });

  it("buffers and consumes buffered signal records atomically", async () => {
    const { redisMock, store } = harness;
    const redisState = new Map<string, string>();
    const stepResults = new Map<string, string>();

    redisMock.get.mockImplementation(async (key: unknown) => {
      return typeof key === "string" ? (redisState.get(key) ?? null) : null;
    });
    redisMock.hget.mockImplementation(
      async (bucket: unknown, stepId: unknown) => {
        return stepResults.get(`${String(bucket)}:${String(stepId)}`) ?? null;
      },
    );
    redisMock.eval.mockImplementation(
      async (
        scriptUnknown: unknown,
        _keyCountUnknown: unknown,
        signalKeyUnknown: unknown,
        arg4?: unknown,
        arg5?: unknown,
        arg6?: unknown,
      ) => {
        const script = String(scriptUnknown);
        const signalKey = String(signalKeyUnknown);

        if (
          script.includes("table.insert(state.history, record)") &&
          script.includes("table.insert(state.queued, record)")
        ) {
          const state = redisState.has(signalKey)
            ? (serializer.parse(redisState.get(signalKey)!) as {
                history: unknown[];
                queued: unknown[];
              })
            : (serializer.parse(String(arg4)) as {
                history: unknown[];
                queued: unknown[];
              });
          const record = serializer.parse(String(arg5));
          state.history.push(record);
          state.queued.push(record);
          redisState.set(signalKey, serializer.stringify(state));
          return "OK";
        }

        if (!script.includes("stepResult.result.payload = record.payload")) {
          return 1;
        }

        const state = serializer.parse(redisState.get(signalKey)!) as {
          queued: Array<{ payload: unknown }>;
          history: unknown[];
        };
        const record = state.queued.shift() ?? null;
        redisState.set(signalKey, serializer.stringify(state));
        if (!record) {
          return null;
        }

        const stepResult = serializer.parse(String(arg6)) as {
          result: Record<string, unknown>;
        };
        stepResult.result.payload = record.payload;
        stepResults.set(
          `${String(arg4)}:${String(arg5)}`,
          serializer.stringify(stepResult),
        );
        return serializer.stringify(record);
      },
    );

    const record = {
      id: "sig-buffer",
      payload: { paidAt: 7 },
      receivedAt: new Date("2024-01-01T00:00:00.000Z"),
    };
    await expect(store.bufferSignalRecord("e1", "paid", record)).resolves.toBe(
      undefined,
    );

    redisState.set(
      "durable:signal:e1:paid",
      serializer.stringify({
        executionId: "e1",
        signalId: "paid",
        queued: [
          {
            id: "sig-buffer",
            payload: { paidAt: 8 },
            receivedAt: new Date("2024-01-01T00:00:00.000Z"),
          },
        ],
        history: [],
      }),
    );

    await expect(
      store.consumeBufferedSignalForStep({
        executionId: "e1",
        stepId: "__signal:paid",
        result: { state: "completed", payload: undefined },
        completedAt: new Date(),
      }),
    ).resolves.toEqual(expect.objectContaining({ payload: { paidAt: 8 } }));

    redisState.set(
      "durable:signal:e1:paid",
      serializer.stringify({
        executionId: "e1",
        signalId: "paid",
        queued: [],
        history: [],
      }),
    );
    await expect(
      store.consumeBufferedSignalForStep({
        executionId: "e1",
        stepId: "__signal:paid",
        result: { state: "completed", payload: undefined },
        completedAt: new Date(),
      }),
    ).resolves.toBeNull();
  });

  it("commits live signal delivery atomically", async () => {
    const { redisMock, store } = harness;
    redisMock.eval.mockResolvedValueOnce(1 as any);

    await expect(
      store.commitSignalDelivery?.({
        executionId: "e1",
        signalId: "paid",
        stepId: "__signal:paid",
        stepResult: {
          executionId: "e1",
          stepId: "__signal:paid",
          result: { state: "completed", payload: { paidAt: 1 } },
          completedAt: new Date(),
        },
        signalRecord: {
          id: "sig-live",
          payload: { paidAt: 1 },
          receivedAt: new Date(),
        },
        timerId: "timeout:e1:paid",
      }),
    ).resolves.toBe(true);

    redisMock.eval.mockResolvedValueOnce(0 as any);
    await expect(
      store.commitSignalDelivery?.({
        executionId: "e1",
        signalId: "paid",
        stepId: "__signal:paid",
        stepResult: {
          executionId: "e1",
          stepId: "__signal:paid",
          result: { state: "completed", payload: { paidAt: 2 } },
          completedAt: new Date(),
        },
        signalRecord: {
          id: "sig-stale",
          payload: { paidAt: 2 },
          receivedAt: new Date(),
        },
      }),
    ).resolves.toBe(false);
  });
});
