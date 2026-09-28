import { AuditLogger } from "../../../durable/core/managers/AuditLogger";
import { ExecutionManager } from "../../../durable/core/managers/ExecutionManager";
import { TaskRegistry } from "../../../durable/core/managers/TaskRegistry";
import { WaitManager } from "../../../durable/core/managers/WaitManager";
import { NoopEventBus } from "../../../durable/bus/NoopEventBus";
import { ExecutionStatus, type Execution } from "../../../durable/core/types";
import type { IDurableStore } from "../../../durable/core/interfaces/store";
import type { ITaskExecutor } from "../../../durable/core/interfaces/service";
import type { ITask } from "../../../../types/task";

export type LifecycleTask = ITask<
  unknown,
  Promise<unknown>,
  any,
  any,
  any,
  any
>;

/** Builds a queue-less ExecutionManager with `task` registered locally. */
export function createLifecycleManager(params: {
  store: IDurableStore;
  task?: LifecycleTask;
  taskExecutor?: ITaskExecutor;
  execution?: { maxContinuationDepth?: number };
}): ExecutionManager {
  const taskRegistry = new TaskRegistry();
  if (params.task) taskRegistry.register(params.task);

  return new ExecutionManager(
    {
      store: params.store,
      eventBus: new NoopEventBus(),
      taskExecutor: params.taskExecutor,
      execution: params.execution,
    },
    taskRegistry,
    new AuditLogger({ enabled: false }, params.store),
    new WaitManager(params.store),
  );
}

/** Executor that records the inputs it was asked to run and echoes them. */
export function createRecordingExecutor(): {
  executor: ITaskExecutor;
  inputs: unknown[];
} {
  const inputs: unknown[] = [];
  return {
    inputs,
    executor: {
      run: async <TResult>(
        _task: unknown,
        input?: unknown,
      ): Promise<TResult> => {
        inputs.push(input);
        return input as TResult;
      },
    },
  };
}

export function lifecycleExecution(
  overrides: Partial<Execution> & { id: string; workflowKey: string },
): Execution {
  return {
    input: undefined,
    status: ExecutionStatus.Completed,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
