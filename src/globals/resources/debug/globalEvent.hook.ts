import { defineHook } from "../../../define";
import { loggerResource as logger } from "../logger.resource";
import { globalTags } from "../../globalTags";
import { hasSystemTag } from "./utils";
import { debugConfig } from "./debugConfig.resource";
import { getConfig } from "./types";

export const globalEventListener = defineHook({
  id: "globals.debug.hooks.onAnyEvent",
  on: "*",
  dependencies: {
    logger,
    debugConfig,
  },
  run: async (event, { logger, debugConfig }) => {
    if (hasSystemTag(event)) {
      return;
    }

    debugConfig = getConfig(debugConfig, event!);
    if (debugConfig.logEventEmissionOnRun) {
      const message = `Event ${String(event!.id)} emitted`;
      await logger.info(message, {
        source: "globals.debug.hooks.onAnyEvent",
        data: debugConfig.logEventEmissionInput
          ? { data: event!.data }
          : undefined,
      });
    }
  },
  meta: {
    title: "Non-system Event Logger",
    description: "Logs all non-system events.",
  },
  tags: [globalTags.system],
});
