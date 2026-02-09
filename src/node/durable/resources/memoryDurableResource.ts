import { globals, r } from "../../../index";
import { MemoryEventBus } from "../bus/MemoryEventBus";
import { MemoryQueue } from "../queue/MemoryQueue";
import { MemoryStore } from "../store/MemoryStore";
import type { RunnerDurableRuntimeConfig } from "../core/createRunnerDurableRuntime";
import { createRunnerDurableRuntime } from "../core/createRunnerDurableRuntime";
import { disposeDurableService } from "../core/DurableService";
import { durableEventsArray } from "../events";
import type { DurableResource } from "../core/DurableResource";
import { durableWorkflowTag } from "../tags/durableWorkflow.tag";

export type MemoryDurableResourceConfig = Omit<
  RunnerDurableRuntimeConfig,
  "store" | "queue" | "eventBus"
> & {
  /**
   * Isolation namespace (used for defaults and docs).
   * Defaults to the resource id (ie. the value passed to `.fork(id)`).
   */
  namespace?: string;
  queue?: { enabled?: boolean };
};

interface MemoryDurableResourceContext {
  runtimeConfig: RunnerDurableRuntimeConfig | null;
}

export const memoryDurableResource = r
  .resource<MemoryDurableResourceConfig>("base.durable.memory")
  .register([durableWorkflowTag, ...durableEventsArray])
  .dependencies({
    taskRunner: globals.resources.taskRunner,
    eventManager: globals.resources.eventManager,
    runnerStore: globals.resources.store,
  })
  .context<MemoryDurableResourceContext>(() => ({ runtimeConfig: null }))
  .init(async function (
    this: { id: string },
    config,
    { taskRunner, eventManager, runnerStore },
    ctx,
  ): Promise<DurableResource> {
    const _namespace = config.namespace ?? this.id;

    const shouldCreateQueue = config.queue?.enabled ?? config.worker === true;
    const queue = shouldCreateQueue ? new MemoryQueue() : undefined;
    const worker = config.worker ?? Boolean(queue);

    const runtimeConfig: RunnerDurableRuntimeConfig = {
      ...config,
      worker,
      store: new MemoryStore(),
      eventBus: new MemoryEventBus(),
      queue,
    };

    ctx.runtimeConfig = runtimeConfig;

    return await createRunnerDurableRuntime(runtimeConfig, {
      taskRunner,
      eventManager,
      runnerStore,
    });
  })
  .dispose(async (durable, _config, _deps, ctx) => {
    if (!ctx.runtimeConfig) return;
    await disposeDurableService(durable.service, ctx.runtimeConfig);
  })
  .build();
