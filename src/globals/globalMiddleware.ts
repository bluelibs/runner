import { cacheMiddleware } from "./middleware/cache.middleware";
import { concurrencyTaskMiddleware } from "./middleware/concurrency.middleware";
import { circuitBreakerMiddleware } from "./middleware/circuitBreaker.middleware";
import { requireContextTaskMiddleware } from "./middleware/requireContext.middleware";
import {
  retryTaskMiddleware,
  retryResourceMiddleware,
} from "./middleware/retry.middleware";
import {
  timeoutTaskMiddleware,
  timeoutResourceMiddleware,
} from "./middleware/timeout.middleware";
import {
  debounceTaskMiddleware,
  throttleTaskMiddleware,
} from "./middleware/temporal.middleware";
import { fallbackTaskMiddleware } from "./middleware/fallback.middleware";
import { rateLimitTaskMiddleware } from "./middleware/rateLimit.middleware";

/**
 * Global middlewares
 */
export const globalMiddlewares = {
  requireContext: requireContextTaskMiddleware,
  task: {
    requireContext: requireContextTaskMiddleware,
    cache: cacheMiddleware,
    concurrency: concurrencyTaskMiddleware,
    debounce: debounceTaskMiddleware,
    throttle: throttleTaskMiddleware,
    fallback: fallbackTaskMiddleware,
    rateLimit: rateLimitTaskMiddleware,
    // common with resources
    retry: retryTaskMiddleware,
    timeout: timeoutTaskMiddleware,
    circuitBreaker: circuitBreakerMiddleware,
  },
  resource: {
    retry: retryResourceMiddleware,
    timeout: timeoutResourceMiddleware,
  },
};
