import { defineHook } from "../../../define";
import { globalResources } from "../../globalResources";
import { globalTags } from "../../globalTags";
import { hasSystemTag } from "./utils";
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
    if (hasSystemTag(event)) {
      return;
    }

    debugConfig = getConfig(debugConfig, event!);
    if (debugConfig.logEventEmissionOnRun) {
      const message = `[event] ${String(event!.id)} emitted`;
      await logger.info(message, {
        data: debugConfig.logEventEmissionInput
          ? { payload: event!.data }
          : undefined,
      });
    }
  },
  meta: {
    title: "Non-system Event Logger",
    description: "Logs all non-system events.",
    tags: [globalTags.system],
  },
});
