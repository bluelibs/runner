import { defineHook } from "../../../define";
import { globalResources } from "../../globalResources";
import { globalEvents } from "../../globalEvents";
import { getConfig } from "./types";
import { debugConfig } from "./debugConfig.resource";
import { hasSystemTag } from "./utils";

export const middlewareTriggeredListener = defineHook({
  id: "debug.middlewareTriggeredListener",
  on: globalEvents.middlewareTriggered,
  dependencies: {
    logger: globalResources.logger,
    debugConfig,
  },
  run: async (event, deps) => {
    if (!deps) return;
    if (hasSystemTag(event.data.middleware)) {
      return;
    }

    const { logger, debugConfig } = deps;
    const cfg = getConfig(debugConfig, event!);
    if (!cfg.logMiddlewareBeforeRun) return;
    const { middleware, kind, targetId } = event.data;
    const msg = `Middleware triggered for ${String(kind)} ${String(targetId)}`;
    await logger.info(msg, {
      source: "debug.middlewareTriggeredListener",
    });
  },
});

export const middlewareCompletedListener = defineHook({
  id: "debug.middlewareCompletedListener",
  on: globalEvents.middlewareCompleted,
  dependencies: {
    logger: globalResources.logger,
    debugConfig,
  },
  run: async (event, deps) => {
    if (!deps) return;

    if (hasSystemTag(event.data.middleware)) {
      return;
    }

    const { logger, debugConfig } = deps;
    const cfg = getConfig(debugConfig, event!);
    if (!cfg.logMiddlewareAfterRun) return;
    const { middleware, kind, targetId } = event.data;
    const msg = `Middleware completed for ${String(kind)} ${String(targetId)}`;
    await logger.info(msg, {
      source: "debug.middlewareCompletedListener",
    });
  },
});
