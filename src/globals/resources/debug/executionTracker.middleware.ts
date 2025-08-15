import { defineMiddleware } from "../../../define";
import { globals } from "../../..";
import { safeStringify } from "./utils";
import { debugConfig } from "./debugConfig.resource";
import { globalResources } from "../../globalResources";
import { globalTags } from "../../globalTags";

export const tasksAndResourcesTrackerMiddleware = defineMiddleware({
  id: "globals.debug.middlewares.tasksAndResourcesTracker",
  dependencies: {
    logger: globalResources.logger,
    debugConfig,
  },
  run: async ({ task, resource, next }, { logger, debugConfig }) => {
    const start = Date.now();

    // Task handling
    if (task) {
      let logString = `[task] ${String(task.definition.id)} starting to run`;
      if (debugConfig.logTaskInput) {
        logString += ` with input: \n${safeStringify(task.input)}`;
      }
      logger.info(logString);
      const result = await next(task.input);
      const duration = Date.now() - start;

      logString = `[task] ${String(
        task.definition.id
      )} completed in ${duration}ms`;
      if (debugConfig.logTaskResult) {
        logString += ` with result: ${safeStringify(result)}`;
      }
      logger.info(logString);
    }

    // Resource handling
    if (resource) {
      let logString = `[resource] ${String(
        resource.definition.id
      )} starting to run`;
      if (debugConfig.logResourceConfig) {
        logString += ` with config: ${safeStringify(resource.config)}`;
      }
      logger.info(logString);
      const result = await next();
      const duration = Date.now() - start;
      logString = `[resource] ${String(
        resource.definition.id
      )} initialized in ${duration}ms`;
      if (debugConfig.logResourceResult) {
        logString += ` with result: ${safeStringify(result)}`;
      }
      logger.info(logString);
    }
  },
  meta: {
    tags: [globalTags.system],
  },
});
