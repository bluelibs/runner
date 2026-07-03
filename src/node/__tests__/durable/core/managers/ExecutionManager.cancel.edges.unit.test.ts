import { ExecutionManager } from "../../../../durable/core/managers/ExecutionManager";
import { AuditLogger } from "../../../../durable/core/managers/AuditLogger";
import { TaskRegistry } from "../../../../durable/core/managers/TaskRegistry";
import { WaitManager } from "../../../../durable/core/managers/WaitManager";
import { NoopEventBus } from "../../../../durable/bus/NoopEventBus";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import type { IDurableStore } from "../../../../durable/core/interfaces/store";
import type { ITask } from "../../../../../types/task";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createBareStore } from "../../helpers/DurableService.unit.helpers";

const task: ITask<unknown, Promise<unknown>, any, any, any, any> = {
  id: "durable-tests-cancel-edges",
} as any;

function createManager(store: IDurableStore): ExecutionManager {
  const taskRegistry = new TaskRegistry();
  taskRegistry.register(task);

  return new ExecutionManager(
    {
      store,
      eventBus: new NoopEventBus(),
    },
    taskRegistry,
    new AuditLogger({ enabled: false }, store),
    new WaitManager(store),
  );
}

function createRunningExecution(): Execution {
  return {
    id: "e1",
    workflowKey: task.id,
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("durable: ExecutionManager cancel edges", () => {
  it("stops retrying cancellation when the execution disappears after contention", async () => {
    const execution = createRunningExecution();
    const saveExecutionIfStatus = jest.fn(async () => false);
    const getExecution = jest.fn<Promise<Execution | null>, [string]>();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      getExecution.mockResolvedValueOnce(execution);
    }
    getExecution.mockResolvedValueOnce(null);
    const store = createBareStore(new MemoryStore(), {
      getExecution,
      saveExecutionIfStatus,
    });

    await expect(
      createManager(store).cancelExecution("e1"),
    ).resolves.toBeUndefined();
    expect(saveExecutionIfStatus).toHaveBeenCalledTimes(10);
  });

  it("stops retrying cancellation when the execution becomes terminal after contention", async () => {
    const execution = createRunningExecution();
    const saveExecutionIfStatus = jest.fn(async () => false);
    const getExecution = jest.fn<Promise<Execution | null>, [string]>();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      getExecution.mockResolvedValueOnce(execution);
    }
    getExecution.mockResolvedValueOnce({
      ...execution,
      status: ExecutionStatus.Completed,
      completedAt: new Date(),
    });
    const store = createBareStore(new MemoryStore(), {
      getExecution,
      saveExecutionIfStatus,
    });

    await expect(
      createManager(store).cancelExecution("e1"),
    ).resolves.toBeUndefined();
    expect(saveExecutionIfStatus).toHaveBeenCalledTimes(10);
  });
});
