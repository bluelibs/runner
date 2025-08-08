import { Context, ContextError } from "../context";
import { defineMiddleware } from "../define";
import { cacheMiddleware } from "./middleware/cache.middleware";
import { requireContextMiddleware } from "./middleware/requireContext.middleware";
import { retryMiddleware } from "./middleware/retry.middleware";
import { timeoutMiddleware } from "./middleware/timeout.middleware";

/**
 * Global middlewares
 */
export const globalMiddlewares = {
  requireContext: requireContextMiddleware,
  retry: retryMiddleware,
  cache: cacheMiddleware,
  timeout: timeoutMiddleware,
};
