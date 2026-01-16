import { globals, r } from "../../../index";
import type { DurableServiceConfig, DurableTask } from "./interfaces/service";
import { initDurableService, disposeDurableService } from "./DurableService";
import { createDurableRunnerAuditEmitter } from "../emitters/runnerAuditEmitter";
import { durableEventsArray } from "../events";
import { AsyncLocalStorage } from "node:async_hooks";
import type { IDurableContext } from "./interfaces/context";
import { DurableResource } from "./DurableResource";
import { initDurableWorker } from "./DurableWorker";
import type { DurableAuditEntry } from "./audit";

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

/**
 * A reusable durable resource template.
 *
 * Usage:
 * - `const durable = durableResource.fork("app.durable");`
 * - Register it via `durable.with({ store, queue, eventBus, ... })`
 */
export const durableResource = r
  .resource<DurableResourceRuntimeConfig>("base.durable")
  .register(durableEventsArray)
  .dependencies({
    taskRunner: globals.resources.taskRunner,
    eventManager: globals.resources.eventManager,
    runnerStore: globals.resources.store,
  })
  .init(async (config, { taskRunner, eventManager, runnerStore }) => {
    const runnerEmitter = createDurableRunnerAuditEmitter({ eventManager });
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
  .dispose(async (durable, config) =>
    disposeDurableService(durable.service, config),
  )
  .build();
