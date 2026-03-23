import { r, resources } from "../../../index";
import { MemoryEventBus } from "../bus/MemoryEventBus";
import { MemoryQueue } from "../queue/MemoryQueue";
import { MemoryStore } from "../store/MemoryStore";
import type { RunnerDurableRuntimeConfig } from "../core/createRunnerDurableRuntime";
import { createRunnerDurableRuntime } from "../core/createRunnerDurableRuntime";
import { disposeDurableService } from "../core/DurableService";
import type { DurableResource } from "../core/DurableResource";
import { Logger } from "../../../models/Logger";

export type MemoryDurableResourceConfig = Omit<
  RunnerDurableRuntimeConfig,
  "store" | "queue" | "eventBus"
> & {
  /**
   * Isolation namespace (used for defaults and docs).
   * Defaults to the resource id (ie. the value passed to `.fork(id)`).
   */
  namespace?: string;
  queue?: {
    enabled?: boolean;
    consume?: boolean;
  };
};

export interface MemoryDurableResourceContext {
  runtimeConfig: RunnerDurableRuntimeConfig | null;
}

export const memoryDurableResource = r
  .resource<MemoryDurableResourceConfig>("base-durable-memory")
  .dependencies({
    taskRunner: resources.taskRunner,
    eventManager: resources.eventManager,
    runnerStore: resources.store,
    logger: resources.logger,
  })
  .context<MemoryDurableResourceContext>(() => ({ runtimeConfig: null }))
  .init(async function (
    this: { id: string },
    config,
    { taskRunner, eventManager, runnerStore, logger },
    resourceContext,
  ): Promise<DurableResource> {
    const baseLogger =
      config.logger ??
      logger ??
      new Logger({
        printThreshold: "error",
        printStrategy: "pretty",
        bufferLogs: false,
      });
    const durableLogger = baseLogger.with({ source: "durable.memory" });

    const shouldCreateQueue =
      config.queue !== undefined ? config.queue.enabled !== false : false;
    const queue = shouldCreateQueue ? new MemoryQueue() : undefined;
    const consumeQueue = queue ? (config.queue?.consume ?? false) : false;

    const runtimeConfig: RunnerDurableRuntimeConfig = {
      ...config,
      logger: durableLogger,
      consumeQueue,
      store: new MemoryStore(),
      eventBus: new MemoryEventBus({
        logger: durableLogger.with({ source: "durable.bus.memory" }),
      }),
      queue,
    };

    resourceContext.runtimeConfig = runtimeConfig;

    return await createRunnerDurableRuntime(runtimeConfig, {
      taskRunner,
      eventManager,
      runnerStore,
      logger: durableLogger,
    });
  })
  .cooldown(async (durable, _config, _deps, resourceContext) => {
    if (!resourceContext.runtimeConfig) return;
    await durable.service.cooldown();
  })
  .dispose(async (durable, _config, _deps, resourceContext) => {
    if (!resourceContext.runtimeConfig) return;
    await disposeDurableService(durable.service, resourceContext.runtimeConfig);
  })
  .build();
