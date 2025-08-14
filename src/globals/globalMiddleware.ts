import { Context, ContextError } from "../context";
import { cacheMiddleware } from "./middleware/cache.middleware";
<<<<<<< HEAD
import { requireContextTaskMiddleware } from "./middleware/requireContext.middleware";
import {
  retryTaskMiddleware,
  retryResourceMiddleware,
} from "./middleware/retry.middleware";
import {
  timeoutTaskMiddleware,
  timeoutResourceMiddleware,
} from "./middleware/timeout.middleware";
=======
import { requireContextMiddleware } from "./middleware/requireContext.middleware";
import { retryMiddleware } from "./middleware/retry.middleware";
import { timeoutMiddleware } from "./middleware/timeout.middleware";
import { authMiddlewares } from "./auth";
>>>>>>> 787204c (Implement complete authentication system with middleware and JWT support)

/**
 * Global middlewares
 */
export const globalMiddlewares = {
<<<<<<< HEAD
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
=======
  requireContext: requireContextMiddleware,
  retry: retryMiddleware,
  cache: cacheMiddleware,
  timeout: timeoutMiddleware,
  auth: authMiddlewares,
>>>>>>> 787204c (Implement complete authentication system with middleware and JWT support)
};
