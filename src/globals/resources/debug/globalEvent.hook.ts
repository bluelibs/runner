import { defineHook } from "../../../definers/defineHook";
import { markFrameworkDefinition } from "../../../definers/markFrameworkDefinition";
import { loggerResource as logger } from "../logger.resource";
import { globalTags } from "../../globalTags";
import { hasSystemTag } from "./utils";
import { debugConfig } from "./debugConfig.resource";
import { getConfig } from "./types";

export const globalEventListener = defineHook(
  markFrameworkDefinition({
    id: "runner.debug.hooks.onAnyEvent",
    on: "*" as const,
    dependencies: {
      logger,
      debugConfig,
    },
    run: async (event, { logger, debugConfig }) => {
      if (hasSystemTag(event) || event!.id.startsWith("system.")) {
        return;
      }

      debugConfig = getConfig(debugConfig, event!);
      if (debugConfig.logEventEmissionOnRun) {
        const message = `Event ${String(event!.id)} emitted`;
        await logger.info(message, {
          source: "runner.debug.hooks.onAnyEvent",
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
  }),
);
