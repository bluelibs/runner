import { defineHook, defineResource } from "../../../define";
import { globalResources } from "../../globalResources";
import { globalTags } from "../../globalTags";
import { hasSystemTag } from "./utils";
import { debugConfig } from "./debugConfig.resource";
import { getConfig } from "./types";
import { globalEvents } from "../../globalEvents";
import { safeStringify } from "../../../models/utils/safeStringify";

export const hookInterceptorResource = defineResource({
  id: "debug.hookInterceptorResource",
  dependencies: {
    logger: globalResources.logger,
    debugConfig,
    eventManager: globalResources.eventManager,
  },
  init: async (event, deps) => {
    deps.eventManager.interceptHook(async (next, hook, event) => {
      const { logger, debugConfig } = deps;

      // Skip logging for system-tagged observability events
      if (hasSystemTag(hook)) {
        return await next(hook, event);
      }

      const resolved = getConfig(debugConfig, event!);
      if (resolved.logHookTriggered) {
        const hookId = hook.id;
        let logString = `Hook triggered for ${String(hookId)}`;
        await logger.info(logString, {
          source: "debug.hookInterceptorResource",
        });
      }

      await next(hook, event);

      if (resolved.logHookCompleted) {
        const hookId = hook.id;
        let logString = `Hook completed for ${String(hookId)}`;
        await logger.info(logString, {
          source: "debug.hookInterceptorResource",
        });
      }
    });
  },
});
