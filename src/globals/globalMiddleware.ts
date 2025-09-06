import { Context, ContextError } from "../context";
import { authMiddlewares } from "./auth";
import { cacheMiddleware } from "./middleware/cache.middleware";
import { requireContextTaskMiddleware } from "./middleware/requireContext.middleware";
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
  requireContext: requireContextTaskMiddleware,
  task: {
    requireContext: requireContextTaskMiddleware,
    cache: cacheMiddleware,
    // common with resources
    retry: retryTaskMiddleware,
    timeout: timeoutTaskMiddleware,
  },
  resource: {
    retry: retryResourceMiddleware,
    timeout: timeoutResourceMiddleware,
  },
  auth: authMiddlewares,
};
