import type { IAsyncContext } from "../../definers/defineAsyncContext";
import { defineTaskMiddleware } from "../../define";
import { markFrameworkDefinition } from "../../definers/markFrameworkDefinition";
import { middlewareContextRequiredError } from "../../errors";
import { Match } from "../../tools/check";

type AsyncContextLike = Pick<IAsyncContext<any>, "use">;

export interface RequireContextMiddlewareConfig {
  context: AsyncContextLike;
}

const requireContextConfigPattern = Match.ObjectIncluding({
  context: Match.ObjectIncluding({
    use: Function,
  }),
});

export const requireContextTaskMiddleware = defineTaskMiddleware(
  markFrameworkDefinition({
    id: "runner.middleware.task.requireContext",
    throws: [middlewareContextRequiredError],
    configSchema: requireContextConfigPattern,
    async run({ task, next }, _deps, config: RequireContextMiddlewareConfig) {
      if (!config.context) {
        middlewareContextRequiredError.throw({
          message:
            "Context not available. Did you forget to pass 'context' to the middleware?",
        });
      }

      // This will throw if the context is not available
      config.context.use();

      return next(task?.input);
    },
  }),
);
