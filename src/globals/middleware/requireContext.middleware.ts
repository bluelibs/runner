import { Context, ContextError } from "../../context";
import { defineMiddleware } from "../../define";

type RequireContextMiddlewareConfig = {
  context: Context<any>;
};

export const requireContextMiddleware = defineMiddleware({
  id: "globals.middleware.requireContext",
  async run(
    { task, resource, next },
    deps,
    config: RequireContextMiddlewareConfig
  ) {
    if (!config.context) {
      throw new Error(
        "Context not available. Did you forget to pass 'context' to the middleware?"
      );
    }

    const ctx = config.context.use();
    if (!ctx) {
      throw new ContextError(
        "Context not available. Did you forget to provide the context via ContextName.provide()?"
      );
    }
    if (task) {
      return next(task.input);
    }
    if (resource) {
      return next(resource.config);
    }

    return next();
  },
});
