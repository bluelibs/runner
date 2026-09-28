import { AuditLogger } from "../../../../durable/core/managers/AuditLogger";
import { ExecutionManager } from "../../../../durable/core/managers/ExecutionManager";
import { TaskRegistry } from "../../../../durable/core/managers/TaskRegistry";
import { WaitManager } from "../../../../durable/core/managers/WaitManager";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import type { IDurableStore } from "../../../../durable/core/interfaces/store";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";

function createManager(store: IDurableStore): ExecutionManager {
  return new ExecutionManager(
    { store },
    new TaskRegistry(),
    new AuditLogger({ enabled: false }, store),
    new WaitManager(store),
  );
}

function createExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: "e-reissue",
    workflowKey: "durable-tests-pause-reissue",
    input: undefined,
    status: ExecutionStatus.Paused,
    pausedAt: new Date(),
    pausedFrom: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("durable: pause re-issue", () => {
  it("does not abort an attempt that a resume started after the stale paused read", async () => {
    const paused = createExecution();
    const resumed = createExecution({
      status: ExecutionStatus.Running,
      pausedFrom: undefined,
    });
    const getExecution = jest
      .fn<Promise<Execution | null>, [string]>()
      .mockResolvedValueOnce(paused)
      .mockResolvedValue(resumed);
    const manager = createManager(
      createBareStore(new MemoryStore(), { getExecution }),
    );
    const resumedAttempt =
      await manager.cancellation.registerAttemptCancellation({
        executionId: "e-reissue",
      });

    await manager.pauseExecution("e-reissue");

    expect(resumedAttempt.signal.aborted).toBe(false);
    resumedAttempt.stop();
  });

  it("re-aborts the live attempt while the execution is still paused", async () => {
    const store = new MemoryStore();
    await store.saveExecution(createExecution());
    const manager = createManager(store);
    const pausedAttempt =
      await manager.cancellation.registerAttemptCancellation({
        executionId: "e-reissue",
      });

    await manager.pauseExecution("e-reissue");

    expect(pausedAttempt.signal.aborted).toBe(true);
    pausedAttempt.stop();
  });
});
