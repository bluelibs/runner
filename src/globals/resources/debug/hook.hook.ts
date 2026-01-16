import { defineResource } from "../../../define";
import { globalResources } from "../../globalResources";
import { globalTags } from "../../globalTags";
import { hasSystemTag } from "./utils";
import { debugConfig } from "./debugConfig.resource";
import { getConfig } from "./types";

export const hookInterceptorResource = defineResource({
  id: "globals.debug.resources.hookInterceptor",
  meta: {
    title: "Hook Interceptor",
    description:
      "Intercepts hooks for debug logging, skipping system-tagged hooks.",
  },
  tags: [globalTags.system],
  dependencies: {
    logger: globalResources.logger,
    debugConfig,
    eventManager: globalResources.eventManager,
  },
  init: async (_event, deps) => {
    deps.eventManager.interceptHook(async (next, hook, event) => {
      const { logger, debugConfig } = deps;

      // Skip logging for system-tagged observability events
      if (hasSystemTag(hook)) {
        return await next(hook, event);
      }

      const resolved = getConfig(debugConfig, event!);
      if (resolved.logHookTriggered) {
        const hookId = hook.id;
        const logString = `Hook triggered for ${String(hookId)}`;
        await logger.info(logString, {
          source: "globals.debug.resources.hookInterceptor",
        });
      }

      await next(hook, event);

      if (resolved.logHookCompleted) {
        const hookId = hook.id;
        const logString = `Hook completed for ${String(hookId)}`;
        await logger.info(logString, {
          source: "globals.debug.resources.hookInterceptor",
        });
      }
    });
  },
});
