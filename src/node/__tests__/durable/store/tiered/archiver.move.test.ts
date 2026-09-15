import { ExecutionStatus } from "../../../../durable/core/types";
import { archiveTerminalExecutions } from "../../../../durable/store/tiered/archiver";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  createStubAuditEntry,
  createStubExecution,
  createStubQueuedSignalRecord,
  createStubSignalRecord,
  createStubStep,
  createStubStore,
  STUB_NOW,
} from "./stub.helpers";

const OLD = new Date("2024-01-01T00:00:00.000Z");

async function seedTerminal(
  store: MemoryStore,
  id: string,
  completedAt: Date = OLD,
): Promise<void> {
  await store.saveExecution(
    createStubExecution({ id, completedAt, updatedAt: completedAt }),
  );
  await store.saveStepResult(createStubStep({ executionId: id }));
  await store.appendAuditEntry(
    createStubAuditEntry({ executionId: id, id: `${id}-audit` }),
  );
  await store.appendSignalRecord(
    id,
    "sig-1",
    createStubSignalRecord({ id: `${id}-h` }),
  );
  await store.enqueueQueuedSignalRecord(
    id,
    "sig-1",
    createStubQueuedSignalRecord({ id: `${id}-q` }),
  );
}

describe("durable: archiveTerminalExecutions", () => {
  it("moves terminal executions with full history", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await seedTerminal(hot, "exec-1");

    const result = await archiveTerminalExecutions({ hot, cold });

    expect(result).toEqual({
      archived: ["exec-1"],
      skipped: [],
      dryRun: false,
    });
    await expect(hot.getExecution("exec-1")).resolves.toBeNull();
    await expect(hot.listStepResults("exec-1")).resolves.toEqual([]);
    await expect(cold.getExecution("exec-1")).resolves.toMatchObject({
      id: "exec-1",
    });
    await expect(cold.listStepResults("exec-1")).resolves.toHaveLength(1);
    await expect(cold.listAuditEntries("exec-1")).resolves.toHaveLength(1);
    const journal = await cold.getSignalState("exec-1", "sig-1");
    expect(journal?.history).toHaveLength(1);
    expect(journal?.queued).toHaveLength(1);
  });

  it("keeps compensation_failed hot unless requested explicitly", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await hot.saveExecution(
      createStubExecution({
        id: "stuck",
        status: ExecutionStatus.CompensationFailed,
        completedAt: OLD,
        updatedAt: OLD,
      }),
    );

    const skipped = await archiveTerminalExecutions({ hot, cold });
    expect(skipped.archived).toEqual([]);
    await expect(hot.getExecution("stuck")).resolves.not.toBeNull();

    const moved = await archiveTerminalExecutions({
      hot,
      cold,
      statuses: [ExecutionStatus.CompensationFailed],
    });
    expect(moved.archived).toEqual(["stuck"]);
    await expect(hot.getExecution("stuck")).resolves.toBeNull();
    await expect(cold.getExecution("stuck")).resolves.not.toBeNull();
  });

  it("archives only the requested statuses", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await hot.saveExecution(
      createStubExecution({
        id: "failed",
        status: ExecutionStatus.Failed,
        completedAt: OLD,
        updatedAt: OLD,
      }),
    );
    await hot.saveExecution(
      createStubExecution({
        id: "completed",
        status: ExecutionStatus.Completed,
        completedAt: OLD,
        updatedAt: OLD,
      }),
    );

    const result = await archiveTerminalExecutions({
      hot,
      cold,
      statuses: [ExecutionStatus.Failed],
    });

    expect(result.archived).toEqual(["failed"]);
    await expect(hot.getExecution("completed")).resolves.not.toBeNull();
  });

  it("skips fresh executions", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await seedTerminal(hot, "old-1");
    await seedTerminal(hot, "fresh", STUB_NOW);

    const result = await archiveTerminalExecutions({
      hot,
      cold,
      now: STUB_NOW,
    });

    expect(result.archived).toEqual(["old-1"]);
    expect(result.skipped).toEqual([
      { executionId: "fresh", reason: "too_fresh" },
    ]);
    await expect(hot.getExecution("fresh")).resolves.not.toBeNull();
  });

  it("honors limit per run", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await seedTerminal(hot, "old-1");
    await seedTerminal(hot, "old-2");
    await seedTerminal(hot, "old-3");

    const result = await archiveTerminalExecutions({ hot, cold, limit: 2 });

    expect(result.archived).toHaveLength(2);
    await expect(hot.listExecutions()).resolves.toHaveLength(1);
  });

  it("falls back to updatedAt when completedAt is missing", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await hot.saveExecution(
      createStubExecution({
        id: "no-completed-at",
        status: ExecutionStatus.Failed,
        completedAt: undefined,
        updatedAt: OLD,
      }),
    );

    const result = await archiveTerminalExecutions({ hot, cold });

    expect(result.archived).toEqual(["no-completed-at"]);
  });

  it("skips candidates that changed state concurrently", async () => {
    const live = createStubExecution({
      id: "live",
      status: ExecutionStatus.Running,
    });
    const hot = createStubStore({
      overrides: {
        listExecutions: jest.fn().mockResolvedValue([live, { id: "ghost" }]),
      },
    });
    await hot.saveExecution(live);
    const cold = new MemoryStore();

    const result = await archiveTerminalExecutions({ hot, cold });

    expect(result.archived).toEqual([]);
    expect(result.skipped).toEqual([
      { executionId: "live", reason: "not_terminal" },
      { executionId: "ghost", reason: "missing_from_hot" },
    ]);
  });

  it("reports candidates without moving in dryRun", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await seedTerminal(hot, "exec-1");

    const result = await archiveTerminalExecutions({ hot, cold, dryRun: true });

    expect(result).toEqual({
      archived: ["exec-1"],
      skipped: [],
      dryRun: true,
    });
    await expect(hot.getExecution("exec-1")).resolves.not.toBeNull();
    await expect(cold.getExecution("exec-1")).resolves.toBeNull();
  });

  it("archives immediately with minAgeMs 0 and an explicit clock", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await seedTerminal(hot, "exec-1", STUB_NOW);

    const result = await archiveTerminalExecutions({
      hot,
      cold,
      minAgeMs: 0,
      now: STUB_NOW,
    });

    expect(result.archived).toEqual(["exec-1"]);
  });

  it("resets cold before copying so reruns stay exact", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await seedTerminal(hot, "exec-1");
    await cold.saveExecution(
      createStubExecution({ id: "exec-1", status: ExecutionStatus.Completed }),
    );
    await cold.appendSignalRecord(
      "exec-1",
      "sig-1",
      createStubSignalRecord({ id: "stale-h" }),
    );

    const result = await archiveTerminalExecutions({ hot, cold });

    expect(result.archived).toEqual(["exec-1"]);
    const journal = await cold.getSignalState("exec-1", "sig-1");
    expect(journal?.history.map((record) => record.id)).toEqual(["exec-1-h"]);
  });
});
