import {
  cacheMiddleware,
  journalKeys as cacheJournalKeys,
} from "./middleware/cache.middleware";
import { concurrencyTaskMiddleware } from "./middleware/concurrency.middleware";
import {
  circuitBreakerMiddleware,
  journalKeys as circuitBreakerJournalKeys,
} from "./middleware/circuitBreaker.middleware";
import { requireContextTaskMiddleware } from "./middleware/requireContext.middleware";
import {
  retryTaskMiddleware,
  retryResourceMiddleware,
  journalKeys as retryJournalKeys,
} from "./middleware/retry.middleware";
import {
  timeoutTaskMiddleware,
  timeoutResourceMiddleware,
  journalKeys as timeoutJournalKeys,
} from "./middleware/timeout.middleware";
import {
  debounceTaskMiddleware,
  throttleTaskMiddleware,
} from "./middleware/temporal.middleware";
import {
  fallbackTaskMiddleware,
  journalKeys as fallbackJournalKeys,
} from "./middleware/fallback.middleware";
import {
  rateLimitTaskMiddleware,
  journalKeys as rateLimitJournalKeys,
} from "./middleware/rateLimit.middleware";

/**
 * Global middlewares
 */
export const globalMiddlewares = {
  requireContext: requireContextTaskMiddleware,
  task: {
    requireContext: requireContextTaskMiddleware,
    cache: Object.assign(cacheMiddleware, {
      journalKeys: cacheJournalKeys,
    }),
    concurrency: concurrencyTaskMiddleware,
    debounce: debounceTaskMiddleware,
    throttle: throttleTaskMiddleware,
    fallback: Object.assign(fallbackTaskMiddleware, {
      journalKeys: fallbackJournalKeys,
    }),
    rateLimit: Object.assign(rateLimitTaskMiddleware, {
      journalKeys: rateLimitJournalKeys,
    }),
    // common with resources
    retry: Object.assign(retryTaskMiddleware, {
      journalKeys: retryJournalKeys,
    }),
    timeout: Object.assign(timeoutTaskMiddleware, {
      journalKeys: timeoutJournalKeys,
    }),
    circuitBreaker: Object.assign(circuitBreakerMiddleware, {
      journalKeys: circuitBreakerJournalKeys,
    }),
  },
  resource: {
    retry: retryResourceMiddleware,
    timeout: timeoutResourceMiddleware,
  },
};
