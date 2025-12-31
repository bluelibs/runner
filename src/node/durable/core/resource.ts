import { globals, r } from "../../../index";
import type { DurableServiceConfig, DurableTask } from "./interfaces/service";
import { initDurableService, disposeDurableService } from "./DurableService";
import { createDurableRunnerAuditEmitter } from "../emitters/runnerAuditEmitter";
import { durableEventsArray } from "../events";
import { AsyncLocalStorage } from "node:async_hooks";
import type { IDurableContext } from "./interfaces/context";
import { DurableResource } from "./DurableResource";
import { initDurableWorker } from "./DurableWorker";

export type DurableResourceRuntimeConfig = Omit<
  DurableServiceConfig,
  "taskExecutor" | "tasks" | "taskResolver" | "contextProvider"
> & {
  /**
   * Starts an embedded worker (queue consumer) in this process.
   * Has effect only when `queue` is configured.
   */
  worker?: boolean;
};

export function createDurableResource(
  id: string,
  config: DurableResourceRuntimeConfig,
) {
  return r
    .resource<void>(id)
    .register(durableEventsArray)
    .dependencies({
      taskRunner: globals.resources.taskRunner,
      eventManager: globals.resources.eventManager,
      runnerStore: globals.resources.store,
    })
    .init(async (_cfg, { taskRunner, eventManager, runnerStore }) => {
      const auditEmitter =
        config.audit?.emitter ??
        (config.audit?.emitRunnerEvents
          ? createDurableRunnerAuditEmitter({ eventManager })
          : undefined);

      const contextStorage = new AsyncLocalStorage<IDurableContext>();

      const service = await initDurableService({
        ...config,
        audit: {
          ...config.audit,
          emitter: auditEmitter,
        },
        taskExecutor: {
          run: async <TInput, TResult>(
            task: DurableTask<TInput, TResult>,
            input?: TInput,
          ) => {
            const outputPromise = await taskRunner.run(task, input);
            if (outputPromise === undefined) {
              throw new Error(
                `Durable task '${task.id}' completed without a result promise.`,
              );
            }
            return await outputPromise;
          },
        },
        taskResolver: (taskId) => {
          const storeTask = runnerStore.tasks.get(taskId);
          return storeTask?.task;
        },
        contextProvider: (ctx, fn) => contextStorage.run(ctx, fn),
      });

      if (config.worker === true && config.queue) {
        await initDurableWorker(service, config.queue);
      }

      return new DurableResource(service, contextStorage);
    })
    .dispose(async (durable) => disposeDurableService(durable.service, config))
    .build();
}
