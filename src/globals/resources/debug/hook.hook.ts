import { defineHook } from "../../../define";
import { globalResources } from "../../globalResources";
import { globalTags } from "../../globalTags";
import { hasSystemTag } from "./utils";
import { debugConfig } from "./debugConfig.resource";
import { getConfig } from "./types";
import { globalEvents } from "../../globalEvents";
import { safeStringify } from "../../../models/utils/safeStringify";

export const hookTriggeredListener = defineHook({
  id: "debug.hookTriggeredListener",
  on: globalEvents.hookTriggered,
  dependencies: {
    logger: globalResources.logger,
    debugConfig,
  },
  run: async (event, deps) => {
    if (!deps) return;
    const { logger, debugConfig } = deps;
    // Skip logging for system-tagged observability events
    if (hasSystemTag(event)) {
      return;
    }

    const resolved = getConfig(debugConfig, event!);
    if (resolved.logHookTriggered) {
      const hookId = event.data?.hook?.id ?? event.id;
      let logString = `Hook triggered for ${String(hookId)}`;
      await logger.info(logString, {
        source: "debug.hookTriggeredListener",
      });
    }
  },
  meta: {
    title: "Hook Listener",
    description: "Logs all hook events.",
    tags: [globalTags.system],
  },
});

export const hookCompletedListener = defineHook({
  id: "debug.hookCompletedListener",
  on: globalEvents.hookCompleted,
  dependencies: {
    logger: globalResources.logger,
    debugConfig,
  },
  run: async (event, deps) => {
    if (!deps) return;
    const { logger, debugConfig } = deps;
    // Skip logging for system-tagged observability events
    if (hasSystemTag(event.data.hook)) {
      return;
    }

    const resolved = getConfig(debugConfig, event!);
    if (resolved.logHookCompleted) {
      const hookId = event.data?.hook?.id ?? event.id;
      let logString = `Hook completed for ${String(hookId)}`;
      await logger.info(logString, {
        source: "debug.hookCompletedListener",
      });
    }
  },
});
