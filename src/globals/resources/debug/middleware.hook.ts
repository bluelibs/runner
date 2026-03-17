import { defineResource } from "../../../definers/defineResource";
import { loggerResource as logger } from "../logger.resource";
import { middlewareManagerResource as middlewareManager } from "../middlewareManager.resource";
import { getConfig } from "./types";
import { debugConfig } from "./debugConfig.resource";
import { isFrameworkDefinition } from "./utils";
import { ITaskMiddlewareExecutionInput } from "../../../types/taskMiddleware";
import { IResourceMiddlewareExecutionInput } from "../../../types/resourceMiddleware";

const id = "middlewareInterceptor";
export const middlewareInterceptorResource = defineResource<
  void,
  Promise<void>,
  {
    logger: typeof logger;
    debugConfig: typeof debugConfig;
    middlewareManager: typeof middlewareManager;
  }
>({
  id,
  meta: {
    title: "Middleware Interceptor",
    description:
      "Intercepts task and resource middleware, skipping framework-owned definitions.",
  },
  dependencies: {
    logger,
    debugConfig,
    middlewareManager,
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
        if (!isFrameworkDefinition(taskDef)) {
          const cfg = getConfig(debugConfig, event!);
          if (cfg.logMiddlewareBeforeRun) {
            const msg = `Middleware triggered for task ${String(taskDef.id)}`;
            await logger.info(msg, {
              source: id,
            });
          }
        }

        const result = await next(input);

        if (!isFrameworkDefinition(taskDef)) {
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
        if (!isFrameworkDefinition(resourceDef)) {
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

        if (!isFrameworkDefinition(resourceDef)) {
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
