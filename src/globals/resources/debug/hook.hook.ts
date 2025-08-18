import { defineHook } from "../../../define";
import { globalResources } from "../../globalResources";
import { globalTags } from "../../globalTags";
import { hasSystemTag } from "./utils";
import { debugConfig } from "./debugConfig.resource";
import { getConfig } from "./types";
import { globalEvents } from "../../globalEvents";
import { safeStringify } from "../../../models/utils/safeStringify";

export const hookTriggeredListener = defineHook({
  id: "globals.debug.tasks.hookTriggeredListener",
  on: globalEvents.hookTriggered,
  dependencies: {
    logger: globalResources.logger,
    debugConfig,
  },
  run: async (event, deps) => {
    if (!deps) return;
    const { logger, debugConfig } = deps;
    if (hasSystemTag((event.data as any)?.hook)) {
      return;
    }

    const resolved = getConfig(debugConfig, event!);
    if (resolved.logHookTriggered) {
      let logString = `[hook] ${
        (event!.data as any)?.hook?.id ?? event!.id
      } triggered`;
      await logger.info(logString);
    }
  },
  meta: {
    title: "Hook Listener",
    description: "Logs all hook events.",
    tags: [globalTags.system],
  },
});

export const hookCompletedListener = defineHook({
  id: "globals.debug.tasks.hookCompletedListener",
  on: globalEvents.hookCompleted,
  dependencies: {
    logger: globalResources.logger,
    debugConfig,
  },
  run: async (event, deps) => {
    if (!deps) return;
    const { logger, debugConfig } = deps;
    // For internal observability events we still want to log when enabled

    const resolved = getConfig(debugConfig, event!);
    if (resolved.logHookCompleted) {
      let logString = `[hook] ${
        (event!.data as any)?.hook?.id ?? event!.id
      } completed`;
      await logger.info(logString);
    }
  },
});
