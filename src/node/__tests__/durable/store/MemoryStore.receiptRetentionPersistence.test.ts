import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../../../durable/store/MemoryStore";
import { PersistentMemoryStore } from "../../../durable/store/PersistentMemoryStore";
import type { DurableCheckpointBranch } from "../../../durable/core/interfaces/history";
import { ExecutionStatus, type Execution } from "../../../durable/core/types";
import { Serializer } from "../../../../serializer";

const t0 = new Date("2025-01-01T00:00:00.000Z");

function completedExecution(
  id: string,
  at: Date,
  overrides: Partial<Execution> = {},
): Execution {
  return {
    id,
    workflowKey: "wf",
    input: { secret: id },
    result: { ok: id },
    status: ExecutionStatus.Completed,
    attempt: 1,
    maxAttempts: 1,
    createdAt: at,
    updatedAt: at,
    completedAt: at,
    retention: { onComplete: { afterMs: 1_000 }, receipts: { afterMs: 5_000 } },
    ...overrides,
  };
}

describe("durable: MemoryStore receipt retention persistence and re-indexing", () => {
  it("persists receipt expiry and re-indexes checkpoint, continuation, retry, and forceFail", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runner-mem-receipt-"));
    const filePath = join(dir, "store.json");
    try {
      const s1 = new PersistentMemoryStore({
        filePath,
        serializer: new Serializer(),
      });
      await s1.init();
      await s1.createExecutionWithIdempotencyKey({
        execution: completedExecution("persisted-1", t0, {
          retention: { onComplete: "retain", receipts: { afterMs: 1_000 } },
        }),
        workflowKey: "wf",
        idempotencyKey: "p-key",
      });
      await s1.dispose();

      const s2 = new PersistentMemoryStore({
        filePath,
        serializer: new Serializer(),
      });
      await s2.init();
      expect(
        await s2.collectExpiredReceipts(new Date(t0.getTime() + 1_000), 10),
      ).toBe(1);
      await expect(
        s2.createExecutionWithIdempotencyKey({
          execution: completedExecution("persisted-2", t0),
          workflowKey: "wf",
          idempotencyKey: "p-key",
        }),
      ).resolves.toEqual({ created: true, executionId: "persisted-2" });
      await s2.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const store = new MemoryStore();
    const parent = completedExecution("p-cont", t0, {
      status: ExecutionStatus.Running,
      retention: { onComplete: "retain", receipts: "delete" },
    });
    await store.saveExecution(parent);
    const branch: DurableCheckpointBranch = {
      expected: parent,
      execution: completedExecution("branch-1", t0, {
        status: ExecutionStatus.Completed,
        retention: { onComplete: "retain", receipts: "delete" },
      }),
      steps: [],
      history: [],
      state: null,
    };
    await expect(store.createCheckpointExecution(branch)).resolves.toBe(true);
    expect(await store.collectExpiredReceipts(t0, 10)).toBe(1);

    const prior = completedExecution("prior-cont", t0, {
      status: ExecutionStatus.Running,
    });
    await store.saveExecution(prior);
    await expect(
      store.createContinuedExecution({
        priorExecution: {
          ...prior,
          status: ExecutionStatus.ContinuedAsNew,
          completedAt: t0,
        },
        successorExecution: completedExecution("succ-cont", t0, {
          retention: { onComplete: "retain", receipts: "delete" },
        }),
      }),
    ).resolves.toBe(true);
    await store.retryRollback("succ-cont");
    await store.forceFail("succ-cont", { message: "forced" });
    expect(await store.collectExpiredReceipts(t0, 10)).toBe(0);
  });
});
