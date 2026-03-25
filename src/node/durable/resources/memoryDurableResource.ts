import { r, resources } from "../../../index";
import { MemoryEventBus } from "../bus/MemoryEventBus";
import { MemoryQueue } from "../queue/MemoryQueue";
import { MemoryStore } from "../store/MemoryStore";
import { PersistentMemoryStore } from "../store/PersistentMemoryStore";
import type { RunnerDurableRuntimeConfig } from "../core/createRunnerDurableRuntime";
import { createRunnerDurableRuntime } from "../core/createRunnerDurableRuntime";
import { disposeDurableService } from "../core/DurableService";
import type { DurableResource } from "../core/DurableResource";
import { Logger } from "../../../models/Logger";
import type { IResource } from "../../../defs";
import type { Serializer } from "../../../serializer";

type DurableSerializerResource = IResource<
  any,
  Promise<Serializer>,
  any,
  any,
  any,
  any,
  any
>;

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
  persist?: {
    /**
     * Local file used to persist the in-memory durable state between restarts.
     *
     * Intended for single-process local/dev scenarios, not shared multi-node
     * deployments.
     */
    filePath: string;
  };
  /**
   * Optional serializer resource used for persistent durable snapshots.
   *
   * Pass the bare resource definition here. Defaults to `resources.serializer`.
   */
  serializer?: DurableSerializerResource;
};

export interface MemoryDurableResourceContext {
  runtimeConfig: RunnerDurableRuntimeConfig | null;
}

export const memoryDurableResource = r
  .resource<MemoryDurableResourceConfig>("base-durable-memory")
  .dependencies((config) => ({
    taskRunner: resources.taskRunner,
    eventManager: resources.eventManager,
    runnerStore: resources.store,
    logger: resources.logger,
    serializer: config.serializer ?? resources.serializer,
  }))
  .context<MemoryDurableResourceContext>(() => ({ runtimeConfig: null }))
  .init(async function (
    this: { id: string },
    config,
    { taskRunner, eventManager, runnerStore, logger, serializer },
    resourceContext,
  ): Promise<DurableResource> {
    const {
      persist,
      serializer: _serializerResource,
      ...memoryConfig
    } = config;
    const baseLogger =
      memoryConfig.logger ??
      logger ??
      new Logger({
        printThreshold: "error",
        printStrategy: "pretty",
        bufferLogs: false,
      });
    const durableLogger = baseLogger.with({ source: "durable.memory" });

    const shouldCreateQueue =
      memoryConfig.queue !== undefined
        ? memoryConfig.queue.enabled !== false
        : false;
    const queue = shouldCreateQueue ? new MemoryQueue() : undefined;
    const store = persist?.filePath
      ? new PersistentMemoryStore({
          filePath: persist.filePath,
          serializer,
        })
      : new MemoryStore();

    const runtimeConfig: RunnerDurableRuntimeConfig = {
      ...memoryConfig,
      logger: durableLogger,
      store,
      eventBus: new MemoryEventBus({
        logger: durableLogger.with({ source: "durable.bus.memory" }),
      }),
      queue,
      roles: {
        ...memoryConfig.roles,
        queueConsumer:
          queue !== undefined && memoryConfig.queue?.consume === true,
      },
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
