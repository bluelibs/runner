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
  run: async (event, { logger, debugConfig }) => {
    if (hasSystemTag(event)) {
      return;
    }

    debugConfig = getConfig(debugConfig, event!);
    if (debugConfig.logHookTriggered) {
      let logString = `[hook] ${event!.id} triggered`;
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
  run: async (event, { logger, debugConfig }) => {
    // For internal observability events we still want to log when enabled

    debugConfig = getConfig(debugConfig, event!);
    if (debugConfig.logHookCompleted) {
      let logString = `[hook] ${event!.id} completed`;
      await logger.info(logString);
    }
  },
});
