import { defineHook } from "../../../definers/defineHook";
import { loggerResource as logger } from "../logger.resource";
import { isFrameworkDefinition } from "./utils";
import { debugConfig } from "./debugConfig.resource";
import { getConfig } from "./types";

export const globalEventListener = defineHook({
  id: "onAnyEvent",
  on: "*" as const,
  dependencies: {
    logger,
    debugConfig,
  },
  run: async (event, { logger, debugConfig }) => {
    if (isFrameworkDefinition(event)) {
      return;
    }

    debugConfig = getConfig(debugConfig, event!);
    if (debugConfig.logEventEmissionOnRun) {
      const message = `Event ${String(event!.id)} emitted`;
      await logger.info(message, {
        source: "onAnyEvent",
        data: debugConfig.logEventEmissionInput
          ? { data: event!.data }
          : undefined,
      });
    }
  },
  meta: {
    title: "Non-framework Event Logger",
    description: "Logs all non-framework events.",
  },
});
