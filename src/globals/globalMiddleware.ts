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
import { identityCheckerTaskMiddleware } from "./middleware/identityChecker.middleware";
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
import { symbolMiddlewareConfiguredFrom } from "../types/symbols";

type MiddlewareWithJournalKeys<TMiddleware, TJournalKeys> = TMiddleware & {
  journalKeys: TJournalKeys;
};

const withJournalKeys = <TMiddleware extends object, TJournalKeys>(
  middleware: TMiddleware,
  journalKeys: TJournalKeys,
): MiddlewareWithJournalKeys<TMiddleware, TJournalKeys> => {
  const wrapped = {
    ...middleware,
    journalKeys,
  } as MiddlewareWithJournalKeys<TMiddleware, TJournalKeys> & {
    [symbolMiddlewareConfiguredFrom]?: unknown;
  };

  wrapped[symbolMiddlewareConfiguredFrom] = middleware;

  return Object.freeze(wrapped);
};

type GlobalMiddlewares = {
  requireContext: typeof requireContextTaskMiddleware;
  identityChecker: typeof identityCheckerTaskMiddleware;
  task: {
    requireContext: typeof requireContextTaskMiddleware;
    identityChecker: typeof identityCheckerTaskMiddleware;
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
 * Built-in middleware factories exposed through the public `middleware` namespace.
 *
 * Task middleware is grouped under `task`, resource middleware under `resource`,
 * and shared shorthands remain available where that improves ergonomics.
 */
export const globalMiddlewares: GlobalMiddlewares = {
  requireContext: requireContextTaskMiddleware,
  identityChecker: identityCheckerTaskMiddleware,
  task: {
    requireContext: requireContextTaskMiddleware,
    identityChecker: identityCheckerTaskMiddleware,
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
