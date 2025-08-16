import { defineHook } from "../../../define";
import { globalResources } from "../../globalResources";
import { globalTags } from "../../globalTags";
import { hasSystemOrLifecycleTag, safeStringify } from "./utils";
import { debugConfig } from "./debugConfig.resource";
import { getConfig } from "./types";
import { globalEvents } from "../../globalEvents";

export const globalEventListener = defineHook({
  id: "globals.debug.tasks.globalEventListener",
  on: "*",
  dependencies: {
    logger: globalResources.logger,
    debugConfig,
  },
  run: async (event, { logger, debugConfig }) => {
    if (hasSystemOrLifecycleTag(event)) {
      return;
    }

    debugConfig = getConfig(debugConfig, event!);
    if (debugConfig.logEventEmissionOnRun) {
      let logString = `[event] ${String(event!.id)} emitted`;
      if (debugConfig.logEventEmissionInput) {
        logString += ` with payload: \n${safeStringify(event!.data)}`;
      }

      await logger.info(logString);
    }
  },
  meta: {
    title: "Non-system Event Logger",
    description: "Logs all non-system events.",
    tags: [globalTags.system],
  },
});
