import type { Execution } from "../../../durable/core/types";
import {
  ExecutionStatus,
  MAX_QUEUED_SIGNALS_PER_KEY,
} from "../../../durable/core/types";
import { setupRedisStoreMock } from "../helpers/RedisStore.mock.helpers";

const harness = setupRedisStoreMock();

function execution(
  id: string,
  status: ExecutionStatus,
  overrides: Partial<Execution> = {},
): Execution {
  return {
    id,
    workflowKey: "continue-task",
    input: undefined,
    status,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const continueRoot = () =>
  harness.store.createContinuedExecution({
    priorExecution: execution("root", ExecutionStatus.ContinuedAsNew, {
      continuedAsExecutionId: "tip",
    }),
    successorExecution: execution("tip", ExecutionStatus.Pending, {
      continuedFromExecutionId: "root",
    }),
  });

describe("durable: RedisStore continuation signal backlog (mock)", () => {
  it("passes every prior signal key and its successor twin to the atomic commit", async () => {
    const { redisMock } = harness;
    redisMock.sscan.mockResolvedValueOnce(["0", ["paid", "a b"]]);
    redisMock.eval.mockResolvedValueOnce(1);

    await expect(continueRoot()).resolves.toBe(true);

    const args = redisMock.eval.mock.calls[0] as unknown[];
    expect(args[0]).toContain("scard");
    expect(args[1]).toBe(13);
    expect(args.slice(9, 15)).toEqual([
      expect.stringContaining("signal_ids:root"),
      expect.stringContaining("signal_ids:tip"),
      expect.stringContaining("signal:root:paid"),
      expect.stringContaining("signal:tip:paid"),
      expect.stringContaining("signal:root:a%20b"),
      expect.stringContaining("signal:tip:a%20b"),
    ]);
    expect(args.slice(-3)).toEqual(["2", "paid", "a b"]);
  });

  it("rescans when a new signal key appeared between the scan and the commit", async () => {
    const { redisMock } = harness;
    redisMock.sscan
      .mockResolvedValueOnce(["0", []])
      .mockResolvedValueOnce(["0", ["paid"]]);
    redisMock.eval
      .mockResolvedValueOnce("__signal_set_changed__")
      .mockResolvedValueOnce(1);

    await expect(continueRoot()).resolves.toBe(true);

    expect(redisMock.eval).toHaveBeenCalledTimes(2);
    expect((redisMock.eval.mock.calls[1] as unknown[]).slice(-2)).toEqual([
      "1",
      "paid",
    ]);
  });

  it("fails fast when the signal key set keeps changing", async () => {
    const { redisMock } = harness;
    redisMock.eval.mockResolvedValue("__signal_set_changed__");

    await expect(continueRoot()).rejects.toThrow(
      "kept racing new signal keys after 5 attempts",
    );
  });

  it("surfaces a successor backlog overflow as the backlog error", async () => {
    const { redisMock } = harness;
    redisMock.eval.mockResolvedValueOnce("__backlog_full__:paid");

    await expect(continueRoot()).rejects.toThrow(
      String(MAX_QUEUED_SIGNALS_PER_KEY),
    );
  });

  it("surfaces corrupt signal state as a store error", async () => {
    const { redisMock } = harness;
    redisMock.eval.mockResolvedValueOnce(
      "__error__:Corrupted durable signal state",
    );

    await expect(continueRoot()).rejects.toThrow(
      "Corrupted durable signal state",
    );
  });
});

describe("durable: RedisStore signal state shape (mock)", () => {
  it("restores array shape for lists Lua encoded as empty objects", async () => {
    const { redisMock, store } = harness;
    redisMock.get.mockResolvedValueOnce(
      JSON.stringify({
        executionId: "root",
        signalId: "paid",
        queued: {},
        history: {},
      }),
    );

    await expect(store.getSignalState("root", "paid")).resolves.toEqual({
      executionId: "root",
      signalId: "paid",
      queued: [],
      history: [],
    });
  });
});
