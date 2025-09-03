import { defineResource } from "../../../define";
import { globalResources } from "../../globalResources";
import { globalTags } from "../../globalTags";
import { getConfig } from "./types";
import { debugConfig } from "./debugConfig.resource";
import { hasSystemTag } from "./utils";
import { ITaskMiddlewareExecutionInput } from "../../../types/taskMiddleware";
import { IResourceMiddlewareExecutionInput } from "../../../types/resourceMiddleware";

const id = "globals.debug.resources.middlewareInterceptor";
export const middlewareInterceptorResource = defineResource({
  id,
  meta: {
    title: "Middleware Interceptor",
    description:
      "Intercepts task and resource middleware, skipping system-tagged entities.",
  },
  tags: [globalTags.system],
  dependencies: {
    logger: globalResources.logger,
    debugConfig,
    middlewareManager: globalResources.middlewareManager,
  },
  init: async (event, deps) => {
    const { logger, debugConfig, middlewareManager } = deps;

    // Task middleware interceptor
    middlewareManager.intercept(
      "task",
      async (
        next: (input: ITaskMiddlewareExecutionInput<any>) => Promise<any>,
        input: ITaskMiddlewareExecutionInput<any>,
      ) => {
        const taskDef = input.task.definition;
        if (!hasSystemTag(taskDef)) {
          const cfg = getConfig(debugConfig, event!);
          if (cfg.logMiddlewareBeforeRun) {
            const msg = `Middleware triggered for task ${String(taskDef.id)}`;
            await logger.info(msg, {
              source: id,
            });
          }
        }

        const result = await next(input);

        if (!hasSystemTag(taskDef)) {
          const cfg = getConfig(debugConfig, event!);
          if (cfg.logMiddlewareAfterRun) {
            const msg = `Middleware completed for task ${String(taskDef.id)}`;
            await logger.info(msg, {
              source: id,
            });
          }
        }

        return result;
      },
    );

    // Resource middleware interceptor
    middlewareManager.intercept(
      "resource",
      async (
        next: (input: IResourceMiddlewareExecutionInput<any>) => Promise<any>,
        input: IResourceMiddlewareExecutionInput<any>,
      ) => {
        const resourceDef = input.resource.definition;
        if (!hasSystemTag(resourceDef)) {
          const cfg = getConfig(debugConfig, event!);
          if (cfg.logMiddlewareBeforeRun) {
            const msg = `Middleware triggered for resource ${String(
              resourceDef.id,
            )}`;
            await logger.info(msg, {
              source: id,
            });
          }
        }

        const result = await next(input);

        if (!hasSystemTag(resourceDef)) {
          const cfg = getConfig(debugConfig, event!);
          if (cfg.logMiddlewareAfterRun) {
            const msg = `Middleware completed for resource ${String(
              resourceDef.id,
            )}`;
            await logger.info(msg, {
              source: id,
            });
          }
        }

        return result;
      },
    );
  },
});
