import {
  cacheProviderResource,
  cacheResource,
} from "./middleware/cache/resource";
import { circuitBreakerResource } from "./middleware/circuitBreaker.middleware";
import { concurrencyResource } from "./middleware/concurrency.middleware";
import { rateLimitResource } from "./middleware/rateLimit.resource";
import { temporalResource } from "./middleware/temporal.resource";
import { cronResource as cron } from "./cron/cron.resource";
import { queueResource } from "./resources/queue.resource";
import { healthResource } from "./resources/health.resource";
import { modeResource } from "./resources/mode.resource";
import { timersResource } from "./resources/timers.resource";
import { runtimeResource } from "./resources/runtime.resource";
import { storeResource } from "./resources/store.resource";
import { debugResource as debug } from "./resources/debug/debug.resource";
import { serializerResource as serializer } from "./resources/serializer.resource";
import { loggerResource as logger } from "./resources/logger.resource";
import { middlewareManagerResource as middlewareManager } from "./resources/middlewareManager.resource";
import { eventManagerResource as eventManager } from "./resources/eventManager.resource";
import { taskRunnerResource as taskRunner } from "./resources/taskRunner.resource";
import { executionContextResource as executionContext } from "./resources/executionContext.resource";

export {
  healthResource as health,
  storeResource as store,
  serializer,
  timersResource as timers,
};

/**
 * Core infrastructure resources that power runtime wiring and execution.
 */
export const systemResources = {
  store: storeResource,
  middlewareManager,
  eventManager,
  taskRunner,
  runtime: runtimeResource,
} as const;

/**
 * Framework-level utility resources that apps commonly depend on directly.
 */
export const runnerResources = {
  mode: modeResource,
  health: healthResource,
  timers: timersResource,
  logger,
  debug,
  serializer,
  executionContext,
  cacheProvider: cacheProviderResource,
  cache: cacheResource,
  cron,
  queue: queueResource,

  // Middleware State Resources
  rateLimit: rateLimitResource,
  circuitBreaker: circuitBreakerResource,
  temporal: temporalResource,
  concurrency: concurrencyResource,
} as const;

/**
 * Complete built-in resource registry exposed through `resources`.
 */
export const globalResources = {
  ...systemResources,
  ...runnerResources,
} as const;
