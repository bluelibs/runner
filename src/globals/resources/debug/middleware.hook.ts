import { defineHook } from "../../../define";
import { globalResources } from "../../globalResources";
import { globalEvents } from "../../globalEvents";
import { getConfig } from "./types";
import { debugConfig } from "./debugConfig.resource";

export const middlewareTriggeredListener = defineHook({
  id: "globals.debug.middleware.triggeredListener",
  on: globalEvents.middlewareTriggered,
  dependencies: {
    logger: globalResources.logger,
    debugConfig,
  },
  run: async (event, deps) => {
    if (!deps) return;
    const { logger, debugConfig } = deps;
    const cfg = getConfig(debugConfig, event!);
    if (!cfg.logMiddlewareBeforeRun) return;
    const { middleware, kind, targetId } = event.data;
    const msg = `[middleware] ${String(middleware.id)} started for ${String(
      kind,
    )} ${String(targetId)}`;
    await logger.info(msg);
  },
});

export const middlewareCompletedListener = defineHook({
  id: "globals.debug.middleware.completedListener",
  on: globalEvents.middlewareCompleted,
  dependencies: {
    logger: globalResources.logger,
    debugConfig,
  },
  run: async (event, deps) => {
    if (!deps) return;
    const { logger, debugConfig } = deps;
    const cfg = getConfig(debugConfig, event!);
    if (!cfg.logMiddlewareAfterRun) return;
    const { middleware, kind, targetId } = event.data;
    const msg = `[middleware] ${String(middleware.id)} completed for ${String(
      kind,
    )} ${String(targetId)}`;
    await logger.info(msg);
  },
});
