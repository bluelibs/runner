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
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";

const task: ITask<unknown, Promise<unknown>, any, any, any, any> = {
  id: "durable-tests-pause-edges",
} as any;

const createFixedTaskExecutor = <TValue>(value: TValue): ITaskExecutor => ({
  run: async <TResult>(): Promise<TResult> => value as unknown as TResult,
});

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

function createExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: "e-edge",
    workflowKey: task.id,
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createContendedStore(reads: Array<Execution | null>): {
  store: IDurableStore;
  saveExecutionIfStatus: jest.Mock;
} {
  const getExecution = jest.fn<Promise<Execution | null>, [string]>();
  for (const read of reads) {
    getExecution.mockResolvedValueOnce(read);
  }
  const saveExecutionIfStatus = jest.fn(async () => false);
  const store = createBareStore(new MemoryStore(), {
    getExecution,
    saveExecutionIfStatus,
  });
  return { store, saveExecutionIfStatus };
}

describe("durable: pause/resume contention edges", () => {
  it("rejects pause when the execution disappears after contention", async () => {
    const execution = createExecution();
    const reads: Array<Execution | null> = Array(10).fill(execution);
    reads.push(null);
    const { store, saveExecutionIfStatus } = createContendedStore(reads);

    await expect(
      createManager({ store }).pauseExecution("e-edge"),
    ).rejects.toThrow('Cannot pause execution "e-edge" with status "unknown".');
    expect(saveExecutionIfStatus).toHaveBeenCalledTimes(10);
  });

  it("treats pause as done when the execution is paused after contention", async () => {
    const execution = createExecution();
    const reads: Array<Execution | null> = Array(10).fill(execution);
    reads.push({
      ...execution,
      status: ExecutionStatus.Paused,
      pausedAt: new Date(),
      pausedFrom: ExecutionStatus.Running,
    });
    const { store, saveExecutionIfStatus } = createContendedStore(reads);

    await expect(
      createManager({ store }).pauseExecution("e-edge"),
    ).resolves.toBeUndefined();
    expect(saveExecutionIfStatus).toHaveBeenCalledTimes(10);
  });

  it("rejects pause when the execution turns terminal after contention", async () => {
    const execution = createExecution();
    const reads: Array<Execution | null> = Array(10).fill(execution);
    reads.push({
      ...execution,
      status: ExecutionStatus.Completed,
      completedAt: new Date(),
    });
    const { store, saveExecutionIfStatus } = createContendedStore(reads);

    await expect(
      createManager({ store }).pauseExecution("e-edge"),
    ).rejects.toThrow(
      'Cannot pause execution "e-edge" with status "completed".',
    );
    expect(saveExecutionIfStatus).toHaveBeenCalledTimes(10);
  });

  it("throws an invariant when pause cannot converge", async () => {
    const execution = createExecution();
    const reads: Array<Execution | null> = Array(11).fill(execution);
    const { store, saveExecutionIfStatus } = createContendedStore(reads);

    await expect(
      createManager({ store }).pauseExecution("e-edge"),
    ).rejects.toThrow(
      "Failed to pause durable execution 'e-edge' after 10 attempts",
    );
    expect(saveExecutionIfStatus).toHaveBeenCalledTimes(10);
  });

  it("rejects resume when the execution disappears after contention", async () => {
    const execution = createExecution({
      status: ExecutionStatus.Paused,
      pausedAt: new Date(),
      pausedFrom: ExecutionStatus.Running,
    });
    const reads: Array<Execution | null> = Array(10).fill(execution);
    reads.push(null);
    const { store, saveExecutionIfStatus } = createContendedStore(reads);

    await expect(
      createManager({ store }).resumeExecution("e-edge"),
    ).rejects.toThrow(
      'Cannot resume execution "e-edge" with status "unknown": it is not paused.',
    );
    expect(saveExecutionIfStatus).toHaveBeenCalledTimes(10);
  });

  it("rejects resume when the execution is no longer paused after contention", async () => {
    const execution = createExecution({
      status: ExecutionStatus.Paused,
      pausedAt: new Date(),
      pausedFrom: ExecutionStatus.Running,
    });
    const reads: Array<Execution | null> = Array(10).fill(execution);
    reads.push(createExecution({ status: ExecutionStatus.Running }));
    const { store, saveExecutionIfStatus } = createContendedStore(reads);

    await expect(
      createManager({ store }).resumeExecution("e-edge"),
    ).rejects.toThrow(
      'Cannot resume execution "e-edge" with status "running": it is not paused.',
    );
    expect(saveExecutionIfStatus).toHaveBeenCalledTimes(10);
  });

  it("throws an invariant when resume cannot converge", async () => {
    const execution = createExecution({
      status: ExecutionStatus.Paused,
      pausedAt: new Date(),
      pausedFrom: ExecutionStatus.Running,
    });
    const reads: Array<Execution | null> = Array(11).fill(execution);
    const { store, saveExecutionIfStatus } = createContendedStore(reads);

    await expect(
      createManager({ store }).resumeExecution("e-edge"),
    ).rejects.toThrow(
      "Failed to resume durable execution 'e-edge' after 10 attempts",
    );
    expect(saveExecutionIfStatus).toHaveBeenCalledTimes(10);
  });

  it("retries resume on optimistic-concurrency conflicts and re-kicks", async () => {
    const backing = new MemoryStore();
    await backing.saveExecution(
      createExecution({
        status: ExecutionStatus.Paused,
        pausedAt: new Date(),
        pausedFrom: ExecutionStatus.Pending,
      }),
    );
    let saves = 0;
    const store = createBareStore(backing, {
      saveExecutionIfStatus: async (execution, expected) => {
        saves += 1;
        if (saves === 1) {
          return false;
        }
        return await backing.saveExecutionIfStatus(execution, expected);
      },
    });
    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor("resumed-ok"),
    });

    await manager.resumeExecution("e-edge");

    expect(saves).toBeGreaterThanOrEqual(2);
    const resumed = await backing.getExecution("e-edge");
    expect(resumed?.status).toBe(ExecutionStatus.Completed);
    expect(resumed?.result).toBe("resumed-ok");
  });
});
