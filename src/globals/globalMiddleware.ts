import { cacheMiddleware } from "./middleware/cache/middleware";
import { concurrencyTaskMiddleware } from "./middleware/concurrency.middleware";
import { circuitBreakerMiddleware } from "./middleware/circuitBreaker.middleware";
import { requireContextTaskMiddleware } from "./middleware/requireContext.middleware";
import { identityCheckerTaskMiddleware } from "./middleware/identityChecker.middleware";
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
import { symbolMiddlewareConfiguredFrom } from "../types/symbols";

const createMiddlewareAlias = <TMiddleware extends object>(
  middleware: TMiddleware,
): TMiddleware => {
  const alias = {
    ...middleware,
  } as TMiddleware & {
    [symbolMiddlewareConfiguredFrom]?: unknown;
  };

  // Keep public namespace references distinct so they can coexist with
  // framework-registered or resource-owned registrations of the same middleware.
  alias[symbolMiddlewareConfiguredFrom] = middleware;

  return Object.freeze(alias);
};

const requireContextMiddlewareAlias = createMiddlewareAlias(
  requireContextTaskMiddleware,
);
const identityCheckerMiddlewareAlias = createMiddlewareAlias(
  identityCheckerTaskMiddleware,
);
const cacheMiddlewareAlias = createMiddlewareAlias(cacheMiddleware);
const concurrencyMiddlewareAlias = createMiddlewareAlias(
  concurrencyTaskMiddleware,
);
const debounceMiddlewareAlias = createMiddlewareAlias(debounceTaskMiddleware);
const throttleMiddlewareAlias = createMiddlewareAlias(throttleTaskMiddleware);
const fallbackMiddlewareAlias = createMiddlewareAlias(fallbackTaskMiddleware);
const rateLimitMiddlewareAlias = createMiddlewareAlias(rateLimitTaskMiddleware);
const retryTaskMiddlewareAlias = createMiddlewareAlias(retryTaskMiddleware);
const timeoutTaskMiddlewareAlias = createMiddlewareAlias(timeoutTaskMiddleware);
const circuitBreakerMiddlewareAlias = createMiddlewareAlias(
  circuitBreakerMiddleware,
);
const retryResourceMiddlewareAlias = createMiddlewareAlias(
  retryResourceMiddleware,
);
const timeoutResourceMiddlewareAlias = createMiddlewareAlias(
  timeoutResourceMiddleware,
);

type GlobalMiddlewares = {
  requireContext: typeof requireContextTaskMiddleware;
  identityChecker: typeof identityCheckerTaskMiddleware;
  task: {
    requireContext: typeof requireContextTaskMiddleware;
    identityChecker: typeof identityCheckerTaskMiddleware;
    cache: typeof cacheMiddleware;
    concurrency: typeof concurrencyTaskMiddleware;
    debounce: typeof debounceTaskMiddleware;
    throttle: typeof throttleTaskMiddleware;
    fallback: typeof fallbackTaskMiddleware;
    rateLimit: typeof rateLimitTaskMiddleware;
    retry: typeof retryTaskMiddleware;
    timeout: typeof timeoutTaskMiddleware;
    circuitBreaker: typeof circuitBreakerMiddleware;
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
  requireContext: requireContextMiddlewareAlias,
  identityChecker: identityCheckerMiddlewareAlias,
  task: {
    requireContext: createMiddlewareAlias(requireContextTaskMiddleware),
    identityChecker: createMiddlewareAlias(identityCheckerTaskMiddleware),
    cache: cacheMiddlewareAlias,
    concurrency: concurrencyMiddlewareAlias,
    debounce: debounceMiddlewareAlias,
    throttle: throttleMiddlewareAlias,
    fallback: fallbackMiddlewareAlias,
    rateLimit: rateLimitMiddlewareAlias,
    // common with resources
    retry: retryTaskMiddlewareAlias,
    timeout: timeoutTaskMiddlewareAlias,
    circuitBreaker: circuitBreakerMiddlewareAlias,
  },
  resource: {
    retry: retryResourceMiddlewareAlias,
    timeout: timeoutResourceMiddlewareAlias,
  },
};
