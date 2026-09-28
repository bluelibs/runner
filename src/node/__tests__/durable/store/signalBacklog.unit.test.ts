import {
  MAX_QUEUED_SIGNALS_PER_KEY,
  MAX_SIGNAL_HISTORY_PER_KEY,
} from "../../../durable/core/types";
import { MemoryStore } from "../../../durable/store/MemoryStore";
import { durableSignalBacklogExceededError } from "../../../../errors";
import { setupRedisStoreMock } from "../helpers/RedisStore.mock.helpers";

const harness = setupRedisStoreMock();

function queuedRecord(index: number) {
  return {
    id: `sig-${index}`,
    payload: { n: index },
    receivedAt: new Date("2024-01-01T00:00:00.000Z"),
  };
}

describe("durable: signal backlog bounds", () => {
  it("rejects buffering past the queued cap without growing it", async () => {
    const store = new MemoryStore();
    for (let n = 0; n < MAX_QUEUED_SIGNALS_PER_KEY; n += 1) {
      await store.bufferSignalRecord("e1", "paid", queuedRecord(n));
    }

    try {
      await store.bufferSignalRecord(
        "e1",
        "paid",
        queuedRecord(MAX_QUEUED_SIGNALS_PER_KEY),
      );
      throw new Error("expected bufferSignalRecord to throw");
    } catch (error) {
      expect(durableSignalBacklogExceededError.is(error)).toBe(true);
    }
    expect((await store.getSignalState("e1", "paid"))?.queued).toHaveLength(
      MAX_QUEUED_SIGNALS_PER_KEY,
    );
  });

  it("rejects queueing past the cap on the enqueue path", async () => {
    const store = new MemoryStore();
    for (let n = 0; n < MAX_QUEUED_SIGNALS_PER_KEY; n += 1) {
      await store.enqueueQueuedSignalRecord("e1", "paid", queuedRecord(n));
    }

    await expect(
      store.enqueueQueuedSignalRecord(
        "e1",
        "paid",
        queuedRecord(MAX_QUEUED_SIGNALS_PER_KEY),
      ),
    ).rejects.toThrow(
      `Signal backlog for signal "paid" on execution "e1" is full (${MAX_QUEUED_SIGNALS_PER_KEY} buffered signals).`,
    );
  });

  it("trims history past the cap keeping the newest records", async () => {
    const store = new MemoryStore();
    const total = MAX_SIGNAL_HISTORY_PER_KEY + 5;
    for (let n = 0; n < total; n += 1) {
      await store.appendSignalRecord("e1", "paid", queuedRecord(n));
    }

    const state = await store.getSignalState("e1", "paid");
    expect(state?.history).toHaveLength(MAX_SIGNAL_HISTORY_PER_KEY);
    expect(state?.history[0]).toMatchObject({ payload: { n: 5 } });
    expect(state?.history[MAX_SIGNAL_HISTORY_PER_KEY - 1]).toMatchObject({
      payload: { n: total - 1 },
    });
  });

  it("maps the Redis backlog sentinel to the backpressure error", async () => {
    const { redisMock, store } = harness;
    redisMock.eval.mockResolvedValueOnce("__backlog_full__");

    try {
      await store.bufferSignalRecord("e1", "paid", queuedRecord(0));
      throw new Error("expected bufferSignalRecord to throw");
    } catch (error) {
      expect(durableSignalBacklogExceededError.is(error)).toBe(true);
    }
  });

  it("ships the queued guard and history trim in the Redis scripts", async () => {
    const { redisMock, store } = harness;
    const scripts: string[] = [];
    redisMock.eval.mockImplementation(async (script: unknown) => {
      scripts.push(String(script));
      return "OK";
    });

    await store.bufferSignalRecord("e1", "paid", queuedRecord(0));
    await store.enqueueQueuedSignalRecord("e1", "paid", queuedRecord(1));
    await store.appendSignalRecord("e1", "paid", queuedRecord(2));

    expect(scripts).toHaveLength(3);
    for (const script of scripts.slice(0, 2)) {
      expect(script).toContain("__backlog_full__");
      expect(script).toContain("#state.queued");
    }
    expect(scripts[2]).not.toContain("__backlog_full__");
    expect(scripts[0]).toContain("state.history");
    expect(scripts[1]).not.toContain("table.insert(state.history, record)");
  });
});
