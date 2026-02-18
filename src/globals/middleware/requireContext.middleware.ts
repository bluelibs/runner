import type { IAsyncContext } from "../../definers/defineAsyncContext";
import { defineTaskMiddleware } from "../../define";
import { middlewareContextRequiredError } from "../../errors";

export interface RequireContextMiddlewareConfig {
  context: IAsyncContext<any>;
}

export const requireContextTaskMiddleware = defineTaskMiddleware({
  id: "globals.middleware.task.requireContext",
  throws: [middlewareContextRequiredError],
  async run({ task, next }, _deps, config: RequireContextMiddlewareConfig) {
    if (!config.context) {
      middlewareContextRequiredError.throw({
        message:
          "Context not available. Did you forget to pass 'context' to the middleware?",
      });
    }

    // This will throw if the context is not available
    const _ctx = config.context.use();

    return next(task?.input);
  },
});
