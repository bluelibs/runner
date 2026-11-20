import {
  serializer,
  setupRedisStoreMock,
} from "../helpers/RedisStore.mock.helpers";
import type { Execution } from "../../../durable/core/types";

const harness = setupRedisStoreMock();

function completedExecution(
  id: string,
  completedAt: Date,
  overrides: Partial<Execution> = {},
): Execution {
  return {
    id,
    workflowKey: "wf",
    input: { secret: 1 },
    result: { ok: id },
    status: "completed",
    createdAt: completedAt,
    updatedAt: completedAt,
    completedAt,
    attempt: 1,
    maxAttempts: 1,
    retention: { onComplete: "retain", receipts: { afterMs: 1_000 } },
    ...overrides,
  };
}

describe("durable: RedisStore receipt retention (mock)", () => {
  it("returns 0 when no receipt cleanup ids are due", async () => {
    const { redisMock, store } = harness;
    redisMock.zrangebyscore.mockResolvedValueOnce([]);
    await expect(store.collectExpiredReceipts(new Date(), 10)).resolves.toBe(0);
    expect(redisMock.eval).not.toHaveBeenCalled();
  });

  it("prunes missing keys, removed policies, and future deadlines without eval", async () => {
    const { redisMock, store } = harness;
    const now = new Date("2025-01-01T00:00:05.000Z");
    const t0 = new Date("2025-01-01T00:00:00.000Z");
    redisMock.zrangebyscore.mockResolvedValueOnce([
      "missing",
      "no-policy",
      "future",
    ]);
    redisMock.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        serializer.stringify(
          completedExecution("no-policy", t0, {
            retention: { onComplete: "retain" },
          }),
        ),
      )
      .mockResolvedValueOnce(
        serializer.stringify(
          completedExecution("future", t0, {
            retention: { onComplete: "retain", receipts: { afterMs: 60_000 } },
          }),
        ),
      );

    await expect(store.collectExpiredReceipts(now, 10)).resolves.toBe(0);
    expect(redisMock.zrem).toHaveBeenCalledTimes(2);
    expect(redisMock.eval).not.toHaveBeenCalled();
  });

  it("collects due receipts with signals, timers, idempotency keys, and commands", async () => {
    const { redisMock, store } = harness;
    const now = new Date("2025-01-01T00:00:10.000Z");
    const t0 = new Date("2025-01-01T00:00:00.000Z");
    const exec1 = completedExecution("exec-1", t0);
    const exec2 = completedExecution("exec-2", t0);

    redisMock.zrangebyscore.mockResolvedValueOnce(["exec-1", "exec-2"]);
    redisMock.get
      .mockResolvedValueOnce(serializer.stringify(exec1))
      .mockResolvedValueOnce(serializer.stringify(exec2));
    redisMock.sscan
      .mockResolvedValueOnce(["0", ["sig-1"]])
      .mockResolvedValueOnce(["0", ["durable:idem:wf:k1"]])
      .mockResolvedValueOnce(["0", ["cmd-1"]])
      .mockResolvedValueOnce(["0", []])
      .mockResolvedValueOnce(["0", []])
      .mockResolvedValueOnce(["0", []]);
    redisMock.hgetall.mockResolvedValueOnce({
      "t-1": serializer.stringify({
        id: "t-1",
        executionId: "exec-1",
        fireAt: t0,
        status: "pending",
        type: "sleep",
      }),
    });
    redisMock.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(store.collectExpiredReceipts(now, 5)).resolves.toBe(1);
    expect(redisMock.hgetall).toHaveBeenCalledTimes(1);
    expect(redisMock.eval).toHaveBeenCalledTimes(2);

    const firstCall = redisMock.eval.mock.calls[0] as unknown[];
    expect(firstCall[1]).toBe(21);
    expect(firstCall[2]).toBe("durable:exec:exec-1");
    expect(firstCall[3]).toBe(
      "durable:execution_index_metadata:receipt_cleanup",
    );
    expect(firstCall[22]).toBe("durable:exec:exec-1:commands");
    expect(firstCall[23]).toBe("exec-1");
    expect(JSON.parse(firstCall[27] as string)).toEqual(["t-1"]);
    expect(JSON.parse(firstCall[28] as string)).toEqual(["durable:idem:wf:k1"]);
    expect(JSON.parse(firstCall[29] as string)).toEqual(["cmd-1"]);
  });
});
