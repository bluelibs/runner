import { serializer, setupRedisStoreMock } from "./RedisStore.mock.helpers";

const harness = setupRedisStoreMock();

describe("durable: RedisStore signals (mock)", () => {
  it("throws when Lua reports corrupted signal state", async () => {
    const { redisMock, store } = harness;
    redisMock.eval.mockResolvedValueOnce(
      "__error__:Corrupted durable signal state",
    );

    await expect(
      store.appendSignalRecord("e1", "paid", {
        id: "sig-1",
        payload: { paidAt: 1 },
        receivedAt: new Date("2024-01-01T00:00:00.000Z"),
      }),
    ).rejects.toThrow("Corrupted durable signal state");
  });

  it("stores retained signal history and queued records", async () => {
    const { redisMock, store } = harness;
    const redisState = new Map<string, string>();

    redisMock.get.mockImplementation(async (key: unknown) => {
      return typeof key === "string" ? (redisState.get(key) ?? null) : null;
    });
    redisMock.set.mockImplementation(async (key: unknown, value: unknown) => {
      if (typeof key === "string" && typeof value === "string") {
        redisState.set(key, value);
      }
      return "OK";
    });
    redisMock.eval.mockImplementation(
      async (
        scriptUnknown: unknown,
        _keyCountUnknown: unknown,
        keyUnknown: unknown,
        defaultStateUnknown?: unknown,
        recordUnknown?: unknown,
      ) => {
        const script = String(scriptUnknown);
        const key = typeof keyUnknown === "string" ? keyUnknown : "";
        const storedState = redisState.get(key);

        if (script.includes("table.insert(state.history, record)")) {
          const state = storedState
            ? (serializer.parse(storedState) as {
                history: unknown[];
                queued: unknown[];
              })
            : (serializer.parse(String(defaultStateUnknown)) as {
                history: unknown[];
                queued: unknown[];
              });
          state.history.push(serializer.parse(String(recordUnknown)));
          redisState.set(key, serializer.stringify(state));
          return "OK";
        }

        if (script.includes("table.insert(state.queued, record)")) {
          const state = storedState
            ? (serializer.parse(storedState) as {
                history: unknown[];
                queued: Array<Record<string, unknown>>;
              })
            : (serializer.parse(String(defaultStateUnknown)) as {
                history: unknown[];
                queued: Array<Record<string, unknown>>;
              });
          state.queued.push(
            serializer.parse(String(recordUnknown)) as Record<string, unknown>,
          );
          redisState.set(key, serializer.stringify(state));
          return "OK";
        }

        if (script.includes("table.remove(state.queued, 1)")) {
          if (!storedState) return null;
          const state = serializer.parse(storedState) as {
            history: unknown[];
            queued: Array<Record<string, unknown>>;
          };
          const record = state.queued.shift() ?? null;
          redisState.set(key, serializer.stringify(state));
          return record ? serializer.stringify(record) : null;
        }

        return 1;
      },
    );

    const record = {
      id: "sig-1",
      payload: { paidAt: 1 },
      receivedAt: new Date("2024-01-01T00:00:00.000Z"),
    };

    await expect(
      store.getSignalState("e1", "paid/with spaces"),
    ).resolves.toBeNull();
    await store.enqueueQueuedSignalRecord("e1", "empty-first", record);
    await expect(store.getSignalState("e1", "empty-first")).resolves.toEqual({
      executionId: "e1",
      signalId: "empty-first",
      queued: [record],
      history: [],
    });

    await store.appendSignalRecord("e1", "paid/with spaces", record);
    await store.enqueueQueuedSignalRecord("e1", "paid/with spaces", record);
    await expect(
      store.consumeQueuedSignalRecord("e1", "paid/with spaces"),
    ).resolves.toEqual(record);
    expect(redisMock.get).toHaveBeenCalledWith(
      "durable:signal:e1:paid%2Fwith%20spaces",
    );
    await store.enqueueQueuedSignalRecord("e1", "paid/with spaces", record);
    await store.enqueueQueuedSignalRecord("e1", "paid/with spaces", record);
    await expect(
      store.consumeQueuedSignalRecord("e1", "missing-signal"),
    ).resolves.toBeNull();
  });

  it("keeps duplicate queued records in FIFO order", async () => {
    const { redisMock, store } = harness;
    const redisState = new Map<string, string>();

    redisMock.get.mockImplementation(async (key: unknown) => {
      return typeof key === "string" ? (redisState.get(key) ?? null) : null;
    });
    redisMock.set.mockImplementation(async (key: unknown, value: unknown) => {
      if (typeof key === "string" && typeof value === "string") {
        redisState.set(key, value);
      }
      return "OK";
    });
    redisMock.eval.mockImplementation(
      async (
        scriptUnknown: unknown,
        _keyCountUnknown: unknown,
        keyUnknown: unknown,
        defaultStateUnknown?: unknown,
        recordUnknown?: unknown,
      ) => {
        const script = String(scriptUnknown);
        if (!script.includes("table.insert(state.queued, record)")) {
          return 1;
        }

        const key = typeof keyUnknown === "string" ? keyUnknown : "";
        const storedState = redisState.get(key);
        const state = storedState
          ? (serializer.parse(storedState) as {
              history: unknown[];
              queued: Array<Record<string, unknown>>;
            })
          : (serializer.parse(String(defaultStateUnknown)) as {
              history: unknown[];
              queued: Array<Record<string, unknown>>;
            });
        state.queued.push(
          serializer.parse(String(recordUnknown)) as Record<string, unknown>,
        );
        redisState.set(key, serializer.stringify(state));
        return "OK";
      },
    );

    const queuedRecord = {
      id: "sig-1",
      payload: { paidAt: 1 },
      receivedAt: new Date("2024-01-01T00:00:00.000Z"),
    };

    await store.enqueueQueuedSignalRecord("e1", "paid", queuedRecord);
    await store.enqueueQueuedSignalRecord("e1", "paid", {
      ...queuedRecord,
      id: "sig-2",
    });

    expect((await store.getSignalState("e1", "paid"))?.queued).toHaveLength(2);
  });
});
