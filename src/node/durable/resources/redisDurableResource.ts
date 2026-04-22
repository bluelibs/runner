import { r, resources } from "../../../index";
import { RedisEventBus } from "../bus/RedisEventBus";
import { RabbitMQQueue } from "../queue/RabbitMQQueue";
import { RedisStore } from "../store/RedisStore";
import type { RunnerDurableRuntimeConfig } from "../core/createRunnerDurableRuntime";
import { createRunnerDurableRuntime } from "../core/createRunnerDurableRuntime";
import { disposeDurableService } from "../core/DurableService";
import type { DurableResource } from "../core/DurableResource";
import { deriveDurableIsolation } from "./isolation";
import { Logger } from "../../../models/Logger";
import type { IResource } from "../../../defs";
import type { Serializer } from "../../../serializer";
import { durableRuntimeTag } from "../tags/durableRuntime.tag";

type DurableSerializerResource = IResource<
  any,
  Promise<Serializer>,
  any,
  any,
  any,
  any,
  any
>;

export type RedisDurableResourceConfig = Omit<
  RunnerDurableRuntimeConfig,
  "store" | "queue" | "eventBus"
> & {
  /**
   * Isolation namespace (used for key prefixes and queue names).
   * Defaults to the resource id (ie. the value passed to `.fork(id)`).
   */
  namespace?: string;
  redis: { url: string };
  store?: { prefix?: string };
  eventBus?: { prefix?: string };
  /**
   * Optional serializer resource used for durable Redis persistence and bus
   * payloads. Pass the bare resource definition here.
   *
   * Defaults to `resources.serializer`.
   */
  serializer?: DurableSerializerResource;
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

export interface RedisDurableResourceContext {
  runtimeConfig: RunnerDurableRuntimeConfig | null;
}

export const redisDurableResource = r
  .resource<RedisDurableResourceConfig>("base-durable-redis")
  .tags([durableRuntimeTag])
  .dependencies((config) => ({
    taskRunner: resources.taskRunner,
    eventManager: resources.eventManager,
    runnerStore: resources.store,
    logger: resources.logger,
    serializer: config.serializer ?? resources.serializer,
  }))
  .context<RedisDurableResourceContext>(() => ({ runtimeConfig: null }))
  .init(async function (
    this: { id: string },
    config,
    { taskRunner, eventManager, runnerStore, logger, serializer },
    resourceContext,
  ): Promise<DurableResource> {
    const { serializer: _serializerResource, ...runtimeConfigInput } = config;
    const namespace = config.namespace ?? this.id;
    const baseLogger =
      config.logger ??
      logger ??
      new Logger({
        printThreshold: "error",
        printStrategy: "pretty",
        bufferLogs: false,
      });
    const durableLogger = baseLogger.with({ source: "durable.redis" });

    const isolation = deriveDurableIsolation({
      namespace,
      storePrefix: config.store?.prefix,
      busPrefix: config.eventBus?.prefix,
      queueName: config.queue?.name,
      deadLetterQueueName: config.queue?.deadLetter,
    });

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

    const runtimeConfig: RunnerDurableRuntimeConfig = {
      ...runtimeConfigInput,
      logger: durableLogger,
      store: new RedisStore({
        redis: config.redis.url,
        prefix: isolation.storePrefix,
        serializer,
      }),
      eventBus: new RedisEventBus({
        redis: config.redis.url,
        prefix: isolation.busPrefix,
        logger: durableLogger.with({ source: "durable.bus.redis" }),
        serializer,
      }),
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
