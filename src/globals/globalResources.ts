import { cacheResource } from "./middleware/cache.middleware";
import { circuitBreakerResource } from "./middleware/circuitBreaker.middleware";
import { concurrencyResource } from "./middleware/concurrency.middleware";
import { rateLimitResource } from "./middleware/rateLimit.middleware";
import { temporalResource } from "./middleware/temporal.middleware";
import { cronResource as cron } from "./cron/cron.resource";
import { queueResource } from "./resources/queue.resource";
import { runtimeResource } from "./resources/runtime.resource";
import { httpClientFactory } from "./resources/httpClientFactory.resource";
import { storeResource } from "./resources/store.resource";
import { debugResource as debug } from "./resources/debug/debug.resource";
import { serializerResource as serializer } from "./resources/serializer.resource";
import { loggerResource as logger } from "./resources/logger.resource";
import { middlewareManagerResource as middlewareManager } from "./resources/middlewareManager.resource";
import { eventManagerResource as eventManager } from "./resources/eventManager.resource";
import { taskRunnerResource as taskRunner } from "./resources/taskRunner.resource";

export { storeResource as store, serializer };

export const globalResources = {
  store: storeResource,
  middlewareManager,
  eventManager,
  taskRunner,
  logger,
  debug,
  serializer,
  cache: cacheResource,
  cron,
  queue: queueResource,
  runtime: runtimeResource,
  httpClientFactory: httpClientFactory,

  // Middleware State Resources
  rateLimit: rateLimitResource,
  circuitBreaker: circuitBreakerResource,
  temporal: temporalResource,
  concurrency: concurrencyResource,
} as const;
