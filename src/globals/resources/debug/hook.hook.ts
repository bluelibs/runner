import { defineResource } from "../../../definers/defineResource";
import { loggerResource as logger } from "../logger.resource";
import { eventManagerResource as eventManager } from "../eventManager.resource";
import { isFrameworkDefinition } from "./utils";
import { debugConfig } from "./debugConfig.resource";
import { getConfig } from "./types";

export const hookInterceptorResource = defineResource<
  void,
  Promise<void>,
  {
    logger: typeof logger;
    debugConfig: typeof debugConfig;
    eventManager: typeof eventManager;
  }
>({
  id: "hookInterceptor",
  meta: {
    title: "Hook Interceptor",
    description:
      "Intercepts hooks for debug logging, skipping framework-owned hooks.",
  },
  dependencies: {
    logger,
    debugConfig,
    eventManager,
  },
  init: async (_event, deps) => {
    deps.eventManager.interceptHook(async (next, hook, event) => {
      const { logger, debugConfig } = deps;

      // Skip logging for framework-owned observability hooks.
      if (isFrameworkDefinition(hook)) {
        return await next(hook, event);
      }

      const resolved = getConfig(debugConfig, event!);
      if (resolved.logHookTriggered) {
        const hookId = hook.id;
        const logString = `Hook triggered for ${String(hookId)}`;
        await logger.info(logString, {
          source: "hookInterceptor",
        });
      }

      await next(hook, event);

      if (resolved.logHookCompleted) {
        const hookId = hook.id;
        const logString = `Hook completed for ${String(hookId)}`;
        await logger.info(logString, {
          source: "hookInterceptor",
        });
      }
    });
  },
});
