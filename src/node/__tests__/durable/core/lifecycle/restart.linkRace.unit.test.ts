import { AuditLogger } from "../../../../durable/core/managers/AuditLogger";
import { ExecutionManager } from "../../../../durable/core/managers/ExecutionManager";
import { TaskRegistry } from "../../../../durable/core/managers/TaskRegistry";
import { WaitManager } from "../../../../durable/core/managers/WaitManager";
import { NoopEventBus } from "../../../../durable/bus/NoopEventBus";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import type { IDurableStore } from "../../../../durable/core/interfaces/store";
import type { ITaskExecutor } from "../../../../durable/core/interfaces/service";
import type { ITask } from "../../../../../types/task";
import { genericError } from "../../../../../errors";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";

type AnyTask = ITask<unknown, Promise<unknown>, any, any, any, any>;

const task: AnyTask = {
  id: "durable-tests-restart-race",
} as any;

function createManager(params: {
  store: IDurableStore;
  taskExecutor?: ITaskExecutor;
}): ExecutionManager {
  const taskRegistry = new TaskRegistry();
  taskRegistry.register(task);

  return new ExecutionManager(
    {
      store: params.store,
      eventBus: new NoopEventBus(),
      taskExecutor: params.taskExecutor,
    },
    taskRegistry,
    new AuditLogger({ enabled: false }, params.store),
    new WaitManager(params.store),
  );
}

function createPausedExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: "e-restart-race",
    workflowKey: task.id,
    input: undefined,
    status: ExecutionStatus.Paused,
    attempt: 1,
    maxAttempts: 1,
    pausedAt: new Date(),
    pausedFrom: ExecutionStatus.Pending,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function flipToResumed(base: MemoryStore, id: string): Promise<void> {
  const source = await base.getExecution(id);
  if (!source) return;
  await base.saveExecution({
    ...source,
    status: ExecutionStatus.Pending,
    pausedFrom: undefined,
    updatedAt: new Date(),
  });
}

describe("durable: restart/resume races", () => {
  it("rejects before persisting when the source disappears after the guard", async () => {
    const base = new MemoryStore();
    await base.saveExecution(createPausedExecution());
    let sourceReads = 0;
    const store = createBareStore(base, {
      getExecution: async (id: string) => {
        if (id !== "e-restart-race") return base.getExecution(id);
        sourceReads += 1;
        return sourceReads === 1 ? base.getExecution(id) : null;
      },
    });
    const manager = createManager({ store });

    await expect(manager.restartExecution("e-restart-race")).rejects.toThrow(
      'Cannot restart execution "e-restart-race" with status "unknown".',
    );
    expect(await base.listExecutions()).toHaveLength(1);
  });

  it("rejects before persisting when the source resumes after the guard", async () => {
    const base = new MemoryStore();
    await base.saveExecution(createPausedExecution());
    let sourceReads = 0;
    const store = createBareStore(base, {
      getExecution: async (id: string) => {
        const execution = await base.getExecution(id);
        if (id !== "e-restart-race" || !execution) return execution;
        sourceReads += 1;
        return sourceReads === 1
          ? execution
          : {
              ...execution,
              status: ExecutionStatus.Pending,
              pausedFrom: undefined,
            };
      },
    });
    const manager = createManager({ store });

    await expect(manager.restartExecution("e-restart-race")).rejects.toThrow(
      'Cannot restart execution "e-restart-race" with status "pending".',
    );
    expect(await base.listExecutions()).toHaveLength(1);
  });

  it("rejects a resumed source at link time without regressing it", async () => {
    const base = new MemoryStore();
    await base.saveExecution(createPausedExecution());
    const store = createBareStore(base, {
      saveExecution: async (execution: Execution) => {
        if (execution.id !== "e-restart-race") {
          await flipToResumed(base, "e-restart-race");
        }
        return base.saveExecution(execution);
      },
    });
    const manager = createManager({ store });

    await expect(manager.restartExecution("e-restart-race")).rejects.toThrow(
      'Cannot restart execution "e-restart-race" with status "pending".',
    );
    const source = await base.getExecution("e-restart-race");
    expect(source?.status).toBe(ExecutionStatus.Pending);
    expect(source?.pausedFrom).toBeUndefined();
    expect(source?.restartedAsExecutionId).toBeUndefined();
    const successor = (await base.listExecutions()).find(
      (execution) => execution.id !== "e-restart-race",
    );
    expect(successor?.status).toBe(ExecutionStatus.Cancelled);
  });

  it("rejects when the link commit loses its race", async () => {
    const base = new MemoryStore();
    await base.saveExecution(createPausedExecution());
    const store = createBareStore(base, {
      saveExecutionIfStatus: async (execution, expected) => {
        if (execution.restartedAsExecutionId) {
          await flipToResumed(base, "e-restart-race");
        }
        return base.saveExecutionIfStatus(execution, expected);
      },
    });
    const manager = createManager({ store });

    await expect(manager.restartExecution("e-restart-race")).rejects.toThrow(
      'Cannot restart execution "e-restart-race" with status "pending".',
    );
    expect((await base.getExecution("e-restart-race"))?.status).toBe(
      ExecutionStatus.Pending,
    );
  });

  it("rejects when the source vanishes before the link commit", async () => {
    const base = new MemoryStore();
    await base.saveExecution(createPausedExecution());
    let sourceReads = 0;
    const store = createBareStore(base, {
      getExecution: async (id: string) => {
        if (id !== "e-restart-race") return base.getExecution(id);
        sourceReads += 1;
        return sourceReads <= 2 ? base.getExecution(id) : null;
      },
    });
    const manager = createManager({ store });

    await expect(manager.restartExecution("e-restart-race")).rejects.toThrow(
      'Cannot restart execution "e-restart-race" with status "unknown".',
    );
    const successor = (await base.listExecutions()).find(
      (execution) => execution.id !== "e-restart-race",
    );
    expect(successor?.status).toBe(ExecutionStatus.Cancelled);
  });

  it("rejects as unknown when the source vanishes mid-link", async () => {
    const base = new MemoryStore();
    await base.saveExecution(createPausedExecution());
    let sourceReads = 0;
    const store = createBareStore(base, {
      getExecution: async (id: string) => {
        if (id !== "e-restart-race") return null;
        sourceReads += 1;
        return sourceReads <= 3 ? base.getExecution(id) : null;
      },
      saveExecutionIfStatus: async () => false,
    });
    const manager = createManager({ store });

    await expect(manager.restartExecution("e-restart-race")).rejects.toThrow(
      'Cannot restart execution "e-restart-race" with status "unknown".',
    );
    const successor = (await base.listExecutions()).find(
      (execution) => execution.id !== "e-restart-race",
    );
    expect(successor?.status).toBe(ExecutionStatus.Pending);
  });

  it("leaves a successor that already started running", async () => {
    const base = new MemoryStore();
    await base.saveExecution(createPausedExecution());
    const store = createBareStore(base, {
      saveExecutionIfStatus: async (execution, expected) => {
        if (execution.restartedAsExecutionId) {
          await flipToResumed(base, "e-restart-race");
          const successorId = execution.restartedAsExecutionId;
          const successor = await base.getExecution(successorId);
          if (successor) {
            await base.saveExecution({
              ...successor,
              status: ExecutionStatus.Running,
            });
          }
        }
        return base.saveExecutionIfStatus(execution, expected);
      },
    });
    const manager = createManager({ store });

    await expect(manager.restartExecution("e-restart-race")).rejects.toThrow(
      'Cannot restart execution "e-restart-race" with status "pending".',
    );
    const successor = (await base.listExecutions()).find(
      (execution) => execution.id !== "e-restart-race",
    );
    expect(successor?.status).toBe(ExecutionStatus.Running);
    expect(successor?.error).toBeUndefined();
  });

  it("rethrows link store failures without cancelling the successor", async () => {
    const base = new MemoryStore();
    await base.saveExecution(
      createPausedExecution({ status: ExecutionStatus.Completed }),
    );
    const store = createBareStore(base, {
      saveExecutionIfStatus: async (execution, expected) => {
        if (execution.restartedAsExecutionId) {
          throw genericError.new({ message: "link-store-down" });
        }
        return base.saveExecutionIfStatus(execution, expected);
      },
    });
    const manager = createManager({ store });

    await expect(manager.restartExecution("e-restart-race")).rejects.toThrow(
      "link-store-down",
    );
    const successor = (await base.listExecutions()).find(
      (execution) => execution.id !== "e-restart-race",
    );
    expect(successor?.status).toBe(ExecutionStatus.Pending);
  });
});
