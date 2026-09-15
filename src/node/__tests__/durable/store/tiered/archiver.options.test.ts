import { ExecutionStatus } from "../../../../durable/core/types";
import { archiveTerminalExecutions } from "../../../../durable/store/tiered/archiver";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  createStubExecution,
  createStubStep,
  createStubStore,
} from "./stub.helpers";

const OLD = new Date("2024-01-01T00:00:00.000Z");

describe("durable: archiveTerminalExecutions guards", () => {
  it.each([[0], [-1], [1.5]])("rejects invalid limit %s", async (limit) => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();

    await expect(
      archiveTerminalExecutions({ hot, cold, limit }),
    ).rejects.toThrow(
      `Cold storage archive limit must be a positive integer. Received: ${limit}.`,
    );
  });

  it.each([[Number.NaN], [-5]])(
    "rejects invalid minAgeMs %s",
    async (minAgeMs) => {
      const hot = new MemoryStore();
      const cold = new MemoryStore();

      await expect(
        archiveTerminalExecutions({ hot, cold, minAgeMs }),
      ).rejects.toThrow("Cold storage archive minAgeMs must be a finite");
    },
  );

  it("rejects non-terminal statuses", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();

    await expect(
      archiveTerminalExecutions({
        hot,
        cold,
        statuses: [ExecutionStatus.Running],
      }),
    ).rejects.toThrow(
      "Cannot archive durable executions with non-terminal status 'running'",
    );
  });

  it("short-circuits an empty status set without listing", async () => {
    const listExecutions = jest.fn();
    const hot = createStubStore({ overrides: { listExecutions } });

    const result = await archiveTerminalExecutions({
      hot,
      cold: new MemoryStore(),
      statuses: [],
    });

    expect(result).toEqual({ archived: [], skipped: [], dryRun: false });
    expect(listExecutions).not.toHaveBeenCalled();
  });

  it("refuses to archive onto the same store", async () => {
    const store = new MemoryStore();

    await expect(
      archiveTerminalExecutions({ hot: store, cold: store }),
    ).rejects.toThrow(
      "Cannot move durable executions between the same store instance",
    );
  });

  it("requires deleteExecutionData on both tiers before copying", async () => {
    const hot = new MemoryStore();
    await hot.saveExecution(
      createStubExecution({ completedAt: OLD, updatedAt: OLD }),
    );
    const bareCold = createStubStore({ without: ["deleteExecutionData"] });

    await expect(
      archiveTerminalExecutions({ hot, cold: bareCold }),
    ).rejects.toThrow(
      "Store does not support deleteExecutionData (cold store)",
    );
    await expect(hot.getExecution("exec-1")).resolves.not.toBeNull();

    const bareHot = createStubStore({ without: ["deleteExecutionData"] });
    await bareHot.saveExecution(
      createStubExecution({ completedAt: OLD, updatedAt: OLD }),
    );
    await expect(
      archiveTerminalExecutions({ hot: bareHot, cold: new MemoryStore() }),
    ).rejects.toThrow("Store does not support deleteExecutionData (hot store)");
  });

  it("fails fast when the cold copy does not verify", async () => {
    const hot = new MemoryStore();
    await hot.saveExecution(
      createStubExecution({ completedAt: OLD, updatedAt: OLD }),
    );
    await hot.saveStepResult(createStubStep());
    const lossyCold = createStubStore({
      overrides: { listStepResults: jest.fn().mockResolvedValue([]) },
    });

    await expect(
      archiveTerminalExecutions({ hot, cold: lossyCold }),
    ).rejects.toThrow(
      "Cold storage copy verification failed for execution 'exec-1'",
    );
    await expect(hot.getExecution("exec-1")).resolves.not.toBeNull();
  });

  it("treats a concurrently deleted hot original as archived", async () => {
    const terminal = createStubExecution({ completedAt: OLD, updatedAt: OLD });
    const hot = createStubStore({
      overrides: {
        getExecution: jest
          .fn()
          .mockResolvedValueOnce(terminal)
          .mockResolvedValueOnce(terminal)
          .mockResolvedValue(null),
        deleteExecutionData: jest.fn(),
      },
    });
    await hot.saveExecution(terminal);
    await hot.saveStepResult(createStubStep());
    const cold = new MemoryStore();

    const result = await archiveTerminalExecutions({ hot, cold });

    expect(result).toEqual({
      archived: ["exec-1"],
      skipped: [],
      dryRun: false,
    });
    expect(hot.deleteExecutionData).not.toHaveBeenCalled();
    await expect(cold.listStepResults("exec-1")).resolves.toHaveLength(1);
  });

  it("leaves hot live when the execution revived before delete", async () => {
    const terminal = createStubExecution({ completedAt: OLD, updatedAt: OLD });
    const revived = createStubExecution({
      status: ExecutionStatus.Pending,
      error: undefined,
    });
    const hot = createStubStore({
      overrides: {
        getExecution: jest
          .fn()
          .mockResolvedValueOnce(terminal)
          .mockResolvedValueOnce(terminal)
          .mockResolvedValue(revived),
        deleteExecutionData: jest.fn(),
      },
    });
    await hot.saveExecution(terminal);
    const cold = new MemoryStore();

    const result = await archiveTerminalExecutions({ hot, cold });

    expect(result.archived).toEqual([]);
    expect(result.skipped).toEqual([
      { executionId: "exec-1", reason: "not_terminal" },
    ]);
    expect(hot.deleteExecutionData).not.toHaveBeenCalled();
    await expect(cold.getExecution("exec-1")).resolves.toMatchObject({
      status: "completed",
    });
  });
});
