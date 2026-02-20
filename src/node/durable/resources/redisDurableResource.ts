import { globals, r } from "../../../index";
import { RedisEventBus } from "../bus/RedisEventBus";
import { RabbitMQQueue } from "../queue/RabbitMQQueue";
import { RedisStore } from "../store/RedisStore";
import type { RunnerDurableRuntimeConfig } from "../core/createRunnerDurableRuntime";
import { createRunnerDurableRuntime } from "../core/createRunnerDurableRuntime";
import { disposeDurableService } from "../core/DurableService";
import { durableEventsArray } from "../events";
import type { DurableResource } from "../core/DurableResource";
import { deriveDurableIsolation } from "./isolation";
import { durableWorkflowTag } from "../tags/durableWorkflow.tag";
import { Logger } from "../../../models/Logger";

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
  queue?: {
    url: string;
    name?: string;
    deadLetter?: string;
    quorum?: boolean;
    messageTtl?: number;
    prefetch?: number;
  };
};

interface RedisDurableResourceContext {
  runtimeConfig: RunnerDurableRuntimeConfig | null;
}

export const redisDurableResource = r
  .resource<RedisDurableResourceConfig>("base.durable.redis")
  .register([durableWorkflowTag, ...durableEventsArray])
  .dependencies({
    taskRunner: globals.resources.taskRunner,
    eventManager: globals.resources.eventManager,
    runnerStore: globals.resources.store,
    logger: globals.resources.logger,
  })
  .context<RedisDurableResourceContext>(() => ({ runtimeConfig: null }))
  .init(async function (
    this: { id: string },
    config,
    { taskRunner, eventManager, runnerStore, logger },
    ctx,
  ): Promise<DurableResource> {
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

    const queue = config.queue
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

    const worker = config.worker ?? Boolean(queue);

    const runtimeConfig: RunnerDurableRuntimeConfig = {
      ...config,
      logger: durableLogger,
      worker,
      store: new RedisStore({
        redis: config.redis.url,
        prefix: isolation.storePrefix,
      }),
      eventBus: new RedisEventBus({
        redis: config.redis.url,
        prefix: isolation.busPrefix,
        logger: durableLogger.with({ source: "durable.bus.redis" }),
      }),
      queue,
    };

    ctx.runtimeConfig = runtimeConfig;

    return await createRunnerDurableRuntime(runtimeConfig, {
      taskRunner,
      eventManager,
      runnerStore,
      logger: durableLogger,
    });
  })
  .dispose(async (durable, _config, _deps, ctx) => {
    if (!ctx.runtimeConfig) return;
    await disposeDurableService(durable.service, ctx.runtimeConfig);
  })
  .build();
