import { r, resources } from "../../../index";
import type { IResource } from "../../../defs";
import { Logger } from "../../../models/Logger";
import type { Serializer } from "../../../serializer";
import { MemoryEventBus } from "../bus/MemoryEventBus";
import {
  createRunnerDurableRuntime,
  type RunnerDurableRuntimeConfig,
} from "../core/createRunnerDurableRuntime";
import type { DurableResource } from "../core/DurableResource";
import { disposeDurableService } from "../core/DurableService";
import { MemoryQueue } from "../queue/MemoryQueue";
import { SqliteStore, type SqliteDatabaseLike } from "../store/SqliteStore";
import { durableRuntimeTag } from "../tags/durableRuntime.tag";
import { deriveDurableIsolation } from "./isolation";

type DurableSerializerResource = IResource<
  any,
  Promise<Serializer>,
  any,
  any,
  any,
  any,
  any
>;

/** Configuration for {@link sqliteDurableResource} (`resources.sqliteWorkflow`). */
export type SqliteDurableResourceConfig = Omit<
  RunnerDurableRuntimeConfig,
  "store" | "queue" | "eventBus"
> & {
  /** Isolation namespace stored alongside every SQLite row; defaults to this resource id. */
  namespace?: string;
  /** SQLite persistence configuration (`filename`, external `database`, `busyTimeoutMs`, `autoCreateTables`). */
  persist?: {
    filename?: string;
    database?: SqliteDatabaseLike;
    busyTimeoutMs?: number;
    autoCreateTables?: boolean;
  };
  /** Optional single-process queue settings. Defaults to disabled. */
  queue?: {
    enabled?: boolean;
    consume?: boolean;
  };
  /** Optional serializer resource used for durable SQLite records. Defaults to `resources.serializer`. */
  serializer?: DurableSerializerResource;
};

/** Context retained by {@link sqliteDurableResource} for graceful cooldown and disposal. */
export interface SqliteDurableResourceContext {
  /** Runtime configuration created during resource initialization. */
  runtimeConfig: RunnerDurableRuntimeConfig | null;
}

/**
 * Built-in Runner resource providing SQLite-backed durable workflows via `node:sqlite`.
 */
export const sqliteDurableResource = r
  .resource<SqliteDurableResourceConfig>("base-durable-sqlite")
  .tags([durableRuntimeTag])
  .dependencies((config) => ({
    taskRunner: resources.taskRunner,
    eventManager: resources.eventManager,
    runnerStore: resources.store,
    logger: resources.logger,
    serializer: config.serializer ?? resources.serializer,
  }))
  .context<SqliteDurableResourceContext>(() => ({ runtimeConfig: null }))
  .init(async function (
    this: { id: string },
    config,
    { taskRunner, eventManager, runnerStore, logger, serializer },
    resourceContext,
  ): Promise<DurableResource> {
    const {
      persist,
      namespace: configuredNamespace,
      serializer: _serializerResource,
      ...sqliteConfig
    } = config;
    const isolation = deriveDurableIsolation({
      namespace: configuredNamespace ?? this.id,
    });
    const baseLogger =
      sqliteConfig.logger ??
      logger ??
      new Logger({
        printThreshold: "error",
        printStrategy: "pretty",
        bufferLogs: false,
      });
    const durableLogger = baseLogger.with({ source: "durable.sqlite" });

    const shouldCreateQueue =
      sqliteConfig.queue !== undefined
        ? sqliteConfig.queue.enabled !== false
        : false;
    const queue = shouldCreateQueue ? new MemoryQueue() : undefined;
    const store = new SqliteStore({
      filename: persist?.filename,
      database: persist?.database,
      busyTimeoutMs: persist?.busyTimeoutMs,
      autoCreateTables: persist?.autoCreateTables,
      namespace: isolation.namespace,
      serializer,
    });

    const runtimeConfig: RunnerDurableRuntimeConfig = {
      ...sqliteConfig,
      logger: durableLogger,
      store,
      eventBus: new MemoryEventBus({
        logger: durableLogger.with({ source: "durable.bus.sqlite" }),
      }),
      queue,
      roles: {
        ...sqliteConfig.roles,
        queueConsumer:
          queue !== undefined && sqliteConfig.queue?.consume === true,
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
