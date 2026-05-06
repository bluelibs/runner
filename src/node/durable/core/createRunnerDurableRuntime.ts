import type { DurableServiceConfig } from "./interfaces/service";
import { initDurableService } from "./DurableService";
import { AsyncLocalStorage } from "node:async_hooks";
import type { IDurableContext } from "./interfaces/context";
import { DurableResource } from "./DurableResource";
import type { DurableAuditEntry } from "./audit";
import { createDurableRunnerAuditEmitter } from "../emitters/runnerAuditEmitter";
import type { EventManager } from "../../../models/EventManager";
import type { TaskRunner } from "../../../models/TaskRunner";
import type { Store } from "../../../models/store/Store";
import type { Logger } from "../../../models/Logger";
import type { ITask } from "../../../types/task";
import { initDurableWorker } from "./DurableWorker";
import { durableExecutionInvariantError } from "../../../errors";
import { runtimeSource } from "../../../types/runtimeSource";
import { getDurableWorkflowKey } from "../tags/durableWorkflow.tag";

export type RunnerDurableRuntimeConfig = Omit<
  DurableServiceConfig,
  "taskExecutor" | "tasks" | "taskResolver" | "contextProvider"
> & {
  /**
   * Advanced runtime-role ownership knobs for low-level durable resources.
   *
   * Built-in workflow resources expose higher-level queue config such as
   * `queue.consume`; this field preserves the same capability for callers that
   * wire custom durable backends via `durableResource`.
   */
  roles?: {
    queueConsumer?: boolean;
  };
};

export interface RunnerDurableDeps {
  taskRunner: TaskRunner;
  eventManager: EventManager;
  runnerStore: Store;
  logger: Logger;
}

function resolveRunnerTask(
  runnerStore: Store,
  workflowKey: string,
): ITask<any, Promise<any>, any, any, any, any> | undefined {
  const registeredTask = runnerStore.tasks.get(workflowKey)?.task;
  if (registeredTask) {
    return registeredTask;
  }

  let legacyMatch: ITask<any, Promise<any>, any, any, any, any> | undefined;
  for (const [registeredId, entry] of runnerStore.tasks.entries()) {
    const persistedWorkflowKey = getDurableWorkflowKey(
      entry.task,
      registeredId,
    );
    if (
      entry.task.id !== workflowKey &&
      registeredId !== workflowKey &&
      persistedWorkflowKey !== workflowKey
    ) {
      continue;
    }

    if (legacyMatch && legacyMatch !== entry.task) {
      return undefined;
    }

    legacyMatch = entry.task;
  }

  return legacyMatch;
}

export async function createRunnerDurableRuntime(
  config: RunnerDurableRuntimeConfig,
  deps: RunnerDurableDeps,
): Promise<DurableResource> {
  const durableCallSource = runtimeSource.resource("durable.runtime");
  const durableLogger = (config.logger ?? deps.logger).with({
    source: "durable.runtime",
  });

  const runnerEmitter = createDurableRunnerAuditEmitter({
    eventManager: deps.eventManager,
    source: durableCallSource,
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
    logger: durableLogger,
    audit: {
      ...config.audit,
      emitter: auditEmitter,
    },
    recovery: {
      ...config.recovery,
    },
    taskExecutor: {
      run: async <TInput, TResult>(
        task: ITask<TInput, Promise<TResult>, any, any, any, any>,
        input?: TInput,
      ) => {
        const output = await deps.taskRunner.run(task, input, {
          source: durableCallSource,
        });
        if (output === undefined) {
          durableExecutionInvariantError.throw({
            message: `Durable task '${task.id}' completed without a result promise.`,
          });
        }
        return output as TResult;
      },
    },
    taskResolver: (workflowKey) => {
      return resolveRunnerTask(deps.runnerStore, workflowKey);
    },
    workflowKeyResolver: (task) => {
      const canonicalTaskId = deps.runnerStore.findIdByDefinition(task);
      return getDurableWorkflowKey(task, canonicalTaskId);
    },
    contextProvider: (durableContext, fn) =>
      contextStorage.run(durableContext, fn),
  });

  if (config.roles?.queueConsumer === true && config.queue) {
    const worker = await initDurableWorker(
      service,
      config.queue,
      durableLogger.with({ source: "durable.worker" }),
    );
    service.registerWorker(worker);
  }

  return new DurableResource(
    service,
    contextStorage,
    config.store,
    deps.runnerStore,
  );
}
