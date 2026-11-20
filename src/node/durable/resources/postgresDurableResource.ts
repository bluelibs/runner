import { r, resources } from "../../../index";
import type { IResource } from "../../../defs";
import { Logger } from "../../../models/Logger";
import type { Serializer } from "../../../serializer";
import { MemoryEventBus } from "../bus/MemoryEventBus";
import { RedisEventBus } from "../bus/RedisEventBus";
import {
  createRunnerDurableRuntime,
  type RunnerDurableRuntimeConfig,
} from "../core/createRunnerDurableRuntime";
import type { DurableResource } from "../core/DurableResource";
import { disposeDurableService } from "../core/DurableService";
import { RabbitMQQueue } from "../queue/RabbitMQQueue";
import {
  PostgresStore,
  type PostgresStoreConfig,
} from "../store/PostgresStore";
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

/** Configuration for {@link postgresDurableResource} (`resources.postgresWorkflow`). */
export type PostgresDurableResourceConfig = Omit<
  RunnerDurableRuntimeConfig,
  "store" | "queue" | "eventBus"
> & {
  /** Isolation namespace for SQL rows, optional Redis bus prefixes, and queues. Defaults to this resource id. */
  namespace?: string;
  /** PostgreSQL connection settings (`pool`, `connectionString`, or `poolConfig`). */
  postgres: Pick<
    PostgresStoreConfig,
    "pool" | "connectionString" | "poolConfig" | "autoCreateTables"
  >;
  /** Optional explicit SQL namespace override. */
  store?: { namespace?: string };
  /** Optional Redis connection for cluster-wide event-bus notifications. */
  redis?: { url: string };
  /** Optional Redis event-bus prefix override. */
  eventBus?: { prefix?: string };
  /** Optional serializer resource used for persisted records and bus payloads. */
  serializer?: DurableSerializerResource;
  /** Optional RabbitMQ queue settings matching `redisWorkflow`. */
  queue?: {
    enabled?: boolean;
    url: string;
    consume?: boolean;
    name?: string;
    deadLetter?: string;
    quorum?: boolean;
    messageTtl?: number;
    prefetch?: number;
  };
};

/** Context retained by {@link postgresDurableResource} for graceful cooldown and disposal. */
export interface PostgresDurableResourceContext {
  /** Runtime configuration created during resource initialization. */
  runtimeConfig: RunnerDurableRuntimeConfig | null;
}

/**
 * Built-in Runner resource providing PostgreSQL-backed durable workflows via `PostgresStore`.
 */
export const postgresDurableResource = r
  .resource<PostgresDurableResourceConfig>("base-durable-postgres")
  .tags([durableRuntimeTag])
  .dependencies((config) => ({
    taskRunner: resources.taskRunner,
    eventManager: resources.eventManager,
    runnerStore: resources.store,
    logger: resources.logger,
    serializer: config.serializer ?? resources.serializer,
  }))
  .context<PostgresDurableResourceContext>(() => ({ runtimeConfig: null }))
  .init(async function (
    this: { id: string },
    config,
    { taskRunner, eventManager, runnerStore, logger, serializer },
    resourceContext,
  ): Promise<DurableResource> {
    const {
      postgres,
      store: storeConfig,
      redis,
      eventBus: eventBusConfig,
      serializer: _serializerResource,
      namespace: configuredNamespace,
      ...runtimeConfigInput
    } = config;
    const isolation = deriveDurableIsolation({
      namespace: configuredNamespace ?? this.id,
      busPrefix: eventBusConfig?.prefix,
      queueName: config.queue?.name,
      deadLetterQueueName: config.queue?.deadLetter,
    });
    const baseLogger =
      config.logger ??
      logger ??
      new Logger({
        printThreshold: "error",
        printStrategy: "pretty",
        bufferLogs: false,
      });
    const durableLogger = baseLogger.with({ source: "durable.postgres" });

    const queue =
      config.queue && config.queue.enabled !== false
        ? new RabbitMQQueue({
            url: config.queue.url,
            prefetch: config.queue.prefetch,
            queue: {
              name: isolation.queueName,
              quorum: config.queue.quorum,
              deadLetter: isolation.deadLetterQueueName,
              messageTtl: config.queue.messageTtl,
            },
          })
        : undefined;

    const eventBus = redis
      ? new RedisEventBus({
          redis: redis.url,
          prefix: isolation.busPrefix,
          logger: durableLogger.with({ source: "durable.bus.redis" }),
          serializer,
        })
      : new MemoryEventBus({
          logger: durableLogger.with({ source: "durable.bus.memory" }),
        });

    const runtimeConfig: RunnerDurableRuntimeConfig = {
      ...runtimeConfigInput,
      logger: durableLogger,
      store: new PostgresStore({
        ...postgres,
        namespace: storeConfig?.namespace ?? isolation.namespace,
        serializer,
      }),
      eventBus,
      queue,
      roles: {
        ...config.roles,
        queueConsumer: queue !== undefined && config.queue?.consume === true,
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
