import type { IAsyncContext } from "../../definers/defineAsyncContext";
import { defineTaskMiddleware } from "../../define";
import { middlewareContextRequiredError } from "../../errors";
import { Match } from "../../tools/check";

type AsyncContextLike = Pick<IAsyncContext<any>, "use">;

/** Configures the context that must be active before a task runs. */
export interface RequireContextMiddlewareConfig {
  /** Context reader invoked before passing control to the task. */
  context: AsyncContextLike;
}

const requireContextConfigPattern = Match.ObjectIncluding({
  context: Match.ObjectIncluding({
    use: Function,
  }),
});

// Schema inference adds index signatures to ObjectIncluding; real contexts are interfaces.
export const requireContextTaskMiddleware =
  defineTaskMiddleware<RequireContextMiddlewareConfig>({
    id: "requireContext",
    meta: {
      title: "Require Context",
      description:
        "Fails fast when the configured async context is missing before the wrapped task runs.",
    },
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
  });
