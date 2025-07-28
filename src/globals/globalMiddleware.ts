import { Context, ContextError } from "../context";
import { defineMiddleware } from "../define";
import { requireContextMiddleware } from "./middleware/requireContext.middleware";
import { retryMiddleware } from "./middleware/retry.middleware";

/**
 * Global middlewares
 */
export const globalMiddlewares = {
  requireContext: requireContextMiddleware,
  retry: retryMiddleware,
};
