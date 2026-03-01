import { globalEventsArray } from "../globals/globalEvents";
import { globalResources } from "../globals/globalResources";
import { requireContextTaskMiddleware } from "../globals/middleware/requireContext.middleware";
import {
  retryTaskMiddleware,
  retryResourceMiddleware,
} from "../globals/middleware/retry.middleware";
import {
  timeoutTaskMiddleware,
  timeoutResourceMiddleware,
} from "../globals/middleware/timeout.middleware";
import {
  concurrencyTaskMiddleware,
  concurrencyResource,
} from "../globals/middleware/concurrency.middleware";
import {
  debounceTaskMiddleware,
  throttleTaskMiddleware,
  temporalResource,
} from "../globals/middleware/temporal.middleware";
import { fallbackTaskMiddleware } from "../globals/middleware/fallback.middleware";
import {
  rateLimitTaskMiddleware,
  rateLimitResource,
} from "../globals/middleware/rateLimit.middleware";
import {
  circuitBreakerMiddleware,
  circuitBreakerResource,
} from "../globals/middleware/circuitBreaker.middleware";
import { tunnelResourceMiddleware } from "../globals/middleware/tunnel.middleware";
import { globalTags } from "../globals/globalTags";
import type { StoreRegistry } from "./StoreRegistry";
import {
  durableExecutionError,
  middlewareCircuitBreakerOpenError,
  middlewareRateLimitExceededError,
  middlewareTimeoutError,
} from "../errors";

export function registerStoreBuiltins(registry: StoreRegistry): void {
  registry.storeGenericItem(globalResources.queue);
  registry.storeGenericItem(globalResources.httpClientFactory);

  Object.values(globalTags).forEach((tag) => {
    registry.storeGenericItem(tag);
  });

  globalEventsArray.forEach((event) => {
    registry.storeGenericItem(event);
  });

  const builtInTaskMiddlewares = [
    requireContextTaskMiddleware,
    retryTaskMiddleware,
    timeoutTaskMiddleware,
    concurrencyTaskMiddleware,
    debounceTaskMiddleware,
    throttleTaskMiddleware,
    fallbackTaskMiddleware,
    rateLimitTaskMiddleware,
    circuitBreakerMiddleware,
  ];
  builtInTaskMiddlewares.forEach((middleware) => {
    registry.storeGenericItem(middleware);
  });

  const builtInResourceMiddlewares = [
    retryResourceMiddleware,
    timeoutResourceMiddleware,
    tunnelResourceMiddleware,
  ];
  builtInResourceMiddlewares.forEach((middleware) => {
    registry.storeGenericItem(middleware);
  });

  const builtInResources = [
    rateLimitResource,
    circuitBreakerResource,
    temporalResource,
    concurrencyResource,
  ];
  builtInResources.forEach((resource) => {
    registry.storeGenericItem(resource);
  });

  const builtInErrors = [
    middlewareTimeoutError,
    middlewareCircuitBreakerOpenError,
    middlewareRateLimitExceededError,
    durableExecutionError,
  ];
  builtInErrors.forEach((helper) => {
    registry.storeGenericItem(helper);
  });
}
