import type { DurableServiceConfig } from "./interfaces/service";
import { initDurableService } from "./DurableService";
import { AsyncLocalStorage } from "node:async_hooks";
import type { IDurableContext } from "./interfaces/context";
import { DurableResource } from "./DurableResource";
import type { DurableAuditEntry } from "./audit";
import { createDurableRunnerAuditEmitter } from "../emitters/runnerAuditEmitter";
import type { EventManager } from "../../../models/EventManager";
import type { TaskRunner } from "../../../models/TaskRunner";
import type { Store } from "../../../models/Store";
import type { ITask } from "../../../types/task";
import { initDurableWorker } from "./DurableWorker";

export type RunnerDurableRuntimeConfig = Omit<
  DurableServiceConfig,
  "taskExecutor" | "tasks" | "taskResolver" | "contextProvider"
> & {
  /**
   * Starts an embedded worker (queue consumer) in this process.
   * Has effect only when `queue` is configured.
   */
  worker?: boolean;
};

export interface RunnerDurableDeps {
  taskRunner: TaskRunner;
  eventManager: EventManager;
  runnerStore: Store;
}

export async function createRunnerDurableRuntime(
  config: RunnerDurableRuntimeConfig,
  deps: RunnerDurableDeps,
): Promise<DurableResource> {
  const runnerEmitter = createDurableRunnerAuditEmitter({
    eventManager: deps.eventManager,
  });

  const userEmitter = config.audit?.emitter;
  const auditEmitter = userEmitter
    ? {
        emit: async (entry: DurableAuditEntry) => {
          try {
            await userEmitter.emit(entry);
          } catch {
            // Emissions must not affect workflow correctness.
          }
          try {
            await runnerEmitter.emit(entry);
          } catch {
            // Emissions must not affect workflow correctness.
          }
        },
      }
    : runnerEmitter;

  const contextStorage = new AsyncLocalStorage<IDurableContext>();

  const service = await initDurableService({
    ...config,
    audit: {
      ...config.audit,
      emitter: auditEmitter,
    },
    taskExecutor: {
      run: async <TInput, TResult>(
        task: ITask<TInput, Promise<TResult>, any, any, any, any>,
        input?: TInput,
      ) => {
        const outputPromise = await deps.taskRunner.run(task, input);
        if (outputPromise === undefined) {
          throw new Error(
            `Durable task '${task.id}' completed without a result promise.`,
          );
        }
        return await outputPromise;
      },
    },
    taskResolver: (taskId) => {
      const storeTask = deps.runnerStore.tasks.get(taskId);
      return storeTask?.task;
    },
    contextProvider: (ctx, fn) => contextStorage.run(ctx, fn),
  });

  if (config.worker === true && config.queue) {
    await initDurableWorker(service, config.queue);
  }

  return new DurableResource(
    service,
    contextStorage,
    config.store,
    deps.runnerStore,
  );
}
