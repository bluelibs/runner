import { SqliteStore } from "../../../durable/store/SqliteStore";
import { ExecutionStatus, type Execution } from "../../../durable/core/types";
import {
  setupRedisStoreMock,
  serializer,
} from "../helpers/RedisStore.mock.helpers";

function makeCompleted(
  id: string,
  completedAt: Date,
  overrides: Partial<Execution> = {},
): Execution {
  return {
    id,
    workflowKey: "wf",
    input: { payload: id },
    result: { ok: id },
    status: ExecutionStatus.Completed,
    attempt: 1,
    maxAttempts: 1,
    createdAt: completedAt,
    updatedAt: completedAt,
    completedAt,
    retention: { onComplete: "delete", receipts: { afterMs: 1_000 } },
    ...overrides,
  };
}

describe("durable: SQL retention paging, lock sweeps, and empty-history checkpoints", () => {
  it("handles zero limits, paginates past protected heads, and sweeps expired locks", async () => {
    const store = new SqliteStore({ filename: ":memory:" });
    try {
      const t0 = new Date("2025-01-01T00:00:00.000Z");
      const dueNow = new Date("2025-01-01T00:00:10.000Z");

      expect(await store.collectCompletedHistory(dueNow, 0)).toBe(0);
      expect(await store.collectExpiredReceipts(dueNow, 0)).toBe(0);
      expect(await store.collectCompletedHistory(dueNow, 1)).toBe(0);
      expect(await store.collectExpiredReceipts(dueNow, 1)).toBe(0);

      // Two protected executions at the front of the deadline order (active leases),
      // followed by two collectable executions so limit=1 (pageLimit=2) exercises cursor paging
      // AND breaking once collected >= limit inside the second page.
      for (const [idx, id] of [
        "a-locked-1",
        "b-locked-2",
        "c-due-1",
        "d-due-2",
      ].entries()) {
        await store.saveExecution(
          makeCompleted(id, new Date(t0.getTime() + idx * 10)),
        );
      }
      const lock1 = await store.acquireLock("execution:a-locked-1", 60_000);
      const lock2 = await store.acquireLock("execution:b-locked-2", 60_000);
      expect(lock1).not.toBeNull();
      expect(lock2).not.toBeNull();

      // Seed an expired lock row to verify collectExpiredReceipts sweeps it.
      const expiredLock = await store.acquireLock(
        "recovery:execution:stale",
        1,
      );
      expect(expiredLock).not.toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(await store.collectCompletedHistory(dueNow, 1)).toBe(1);
      expect(
        (await store.getExecution("c-due-1"))?.historyCollectedAt,
      ).toBeDefined();
      expect(
        (await store.getExecution("d-due-2"))?.historyCollectedAt,
      ).toBeUndefined();

      expect(await store.collectExpiredReceipts(dueNow, 1)).toBe(1);
      expect(await store.getExecution("c-due-1")).toBeNull();
      expect(await store.getExecution("d-due-2")).not.toBeNull();

      // Remaining due execution collects on next tick, then empty page exits cleanly.
      expect(await store.collectExpiredReceipts(dueNow, 5)).toBe(1);
      expect(await store.getExecution("d-due-2")).toBeNull();

      // Create checkpoint branch with empty history (verifies sequence=0 without -Infinity).
      const source = makeCompleted("source-empty", t0, {
        status: ExecutionStatus.Pending,
        completedAt: undefined,
      });
      await store.saveExecution(source);
      const created = await store.createCheckpointExecution({
        expected: source,
        execution: { ...source, id: "branch-empty" },
        steps: [],
        history: [],
        state: null,
      });
      expect(created).toBe(true);
    } finally {
      await store.dispose();
    }
  });
});

describe("durable: RedisStore empty-history checkpoint sequence", () => {
  const harness = setupRedisStoreMock();

  it("writes sequence 0 when branch history is empty", async () => {
    const { store, redisMock } = harness;
    const now = new Date("2025-01-01T00:00:00.000Z");
    const source: Execution = {
      id: "src-empty",
      workflowKey: "wf",
      input: undefined,
      status: ExecutionStatus.Pending,
      attempt: 1,
      maxAttempts: 1,
      createdAt: now,
      updatedAt: now,
    };
    redisMock.get.mockResolvedValueOnce(serializer.stringify(source));
    redisMock.eval.mockResolvedValueOnce(1);

    await expect(
      store.createCheckpointExecution({
        expected: source,
        execution: { ...source, id: "branch-empty" },
        steps: [],
        history: [],
        state: null,
      }),
    ).resolves.toBe(true);

    const evalArgs = redisMock.eval.mock.calls[0] as unknown[];
    // ARGV[10] is the history sequence (10 keys + 2 header args + 9 preceding ARGV = index 21)
    expect(evalArgs[21]).toBe(0);
  });
});
