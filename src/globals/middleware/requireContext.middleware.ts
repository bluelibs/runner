import type { IAsyncContext } from "../../definers/defineAsyncContext";
import { defineTaskMiddleware } from "../../define";

type RequireContextMiddlewareConfig = {
  context: IAsyncContext<any>;
};

export const requireContextTaskMiddleware = defineTaskMiddleware({
  id: "globals.middleware.requireContext",
  async run({ task, next }, _deps, config: RequireContextMiddlewareConfig) {
    if (!config.context) {
      throw new Error(
        "Context not available. Did you forget to pass 'context' to the middleware?",
      );
    }

    // This will throw if the context is not available
    const _ctx = config.context.use();

    return next(task?.input);
  },
});
