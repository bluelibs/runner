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

type MiddlewareWithJournalKeys<TMiddleware, TJournalKeys> = TMiddleware & {
  journalKeys: TJournalKeys;
};

const withJournalKeys = <TMiddleware extends object, TJournalKeys>(
  middleware: TMiddleware,
  journalKeys: TJournalKeys,
): MiddlewareWithJournalKeys<TMiddleware, TJournalKeys> =>
  Object.freeze({
    ...middleware,
    journalKeys,
  }) as MiddlewareWithJournalKeys<TMiddleware, TJournalKeys>;

type GlobalMiddlewares = {
  requireContext: typeof requireContextTaskMiddleware;
  task: {
    requireContext: typeof requireContextTaskMiddleware;
    cache: MiddlewareWithJournalKeys<
      typeof cacheMiddleware,
      typeof cacheJournalKeys
    >;
    concurrency: typeof concurrencyTaskMiddleware;
    debounce: typeof debounceTaskMiddleware;
    throttle: typeof throttleTaskMiddleware;
    fallback: MiddlewareWithJournalKeys<
      typeof fallbackTaskMiddleware,
      typeof fallbackJournalKeys
    >;
    rateLimit: MiddlewareWithJournalKeys<
      typeof rateLimitTaskMiddleware,
      typeof rateLimitJournalKeys
    >;
    retry: MiddlewareWithJournalKeys<
      typeof retryTaskMiddleware,
      typeof retryJournalKeys
    >;
    timeout: MiddlewareWithJournalKeys<
      typeof timeoutTaskMiddleware,
      typeof timeoutJournalKeys
    >;
    circuitBreaker: MiddlewareWithJournalKeys<
      typeof circuitBreakerMiddleware,
      typeof circuitBreakerJournalKeys
    >;
  };
  resource: {
    retry: typeof retryResourceMiddleware;
    timeout: typeof timeoutResourceMiddleware;
  };
};

/**
 * Global middlewares
 */
export const globalMiddlewares: GlobalMiddlewares = {
  requireContext: requireContextTaskMiddleware,
  task: {
    requireContext: requireContextTaskMiddleware,
    cache: withJournalKeys(cacheMiddleware, cacheJournalKeys),
    concurrency: concurrencyTaskMiddleware,
    debounce: debounceTaskMiddleware,
    throttle: throttleTaskMiddleware,
    fallback: withJournalKeys(fallbackTaskMiddleware, fallbackJournalKeys),
    rateLimit: withJournalKeys(rateLimitTaskMiddleware, rateLimitJournalKeys),
    // common with resources
    retry: withJournalKeys(retryTaskMiddleware, retryJournalKeys),
    timeout: withJournalKeys(timeoutTaskMiddleware, timeoutJournalKeys),
    circuitBreaker: withJournalKeys(
      circuitBreakerMiddleware,
      circuitBreakerJournalKeys,
    ),
  },
  resource: {
    retry: retryResourceMiddleware,
    timeout: timeoutResourceMiddleware,
  },
};
