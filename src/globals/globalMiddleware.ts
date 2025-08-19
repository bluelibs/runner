import { Context, ContextError } from "../context";
import { cacheMiddleware } from "./middleware/cache.middleware";
import { requireContextMiddleware } from "./middleware/requireContext.middleware";
import {
  retryTaskMiddleware,
  retryResourceMiddleware,
} from "./middleware/retry.middleware";
import {
  timeoutTaskMiddleware,
  timeoutResourceMiddleware,
} from "./middleware/timeout.middleware";

/**
 * Global middlewares
 */
export const globalMiddlewares = {
  requireContext: requireContextMiddleware,
  retry: { task: retryTaskMiddleware, resource: retryResourceMiddleware },
  cache: cacheMiddleware,
  timeout: { task: timeoutTaskMiddleware, resource: timeoutResourceMiddleware },
};
