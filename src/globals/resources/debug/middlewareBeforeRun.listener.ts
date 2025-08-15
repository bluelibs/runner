import { defineTask } from "../../../define";
import { globalEvents } from "../../globalEvents";
import { globalResources } from "../../globalResources";
import { globalTags } from "../../globalTags";
import { debugConfig } from "./debugConfig.resource";
import { getConfig } from "./types";

export const middlewareBeforeRunListener = defineTask({
  id: "globals.debug.tasks.middlewareBeforeRunListener",
  on: globalEvents.middlewares.beforeRun,
  dependencies: {
    logger: globalResources.logger,
    debugConfig: debugConfig,
  },
  run: async (event, { logger, debugConfig }) => {
    const data = event.data;
    const context = data.task ? "task" : "resource";
    const id = data.task
      ? data.task.definition.id
      : data.resource.definition.id;
    const middlewareId = event.data.middleware.id;

    debugConfig = getConfig(debugConfig, event.data.middleware);

    if (debugConfig.logMiddlewareBeforeRun) {
      let logString = `[middleware] ${String(middlewareId)} wrapping`;
      logString += ` ${context}: ${String(id)}`;
      await logger.info(logString);
    }
  },
  meta: {
    tags: [globalTags.system],
  },
});
