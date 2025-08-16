import { defineMiddleware } from "../../../define";
import { hasSystemOrLifecycleTag, safeStringify } from "./utils";
import { debugConfig } from "./debugConfig.resource";
import { globalResources } from "../../globalResources";
import { globalTags } from "../../globalTags";
import { getConfig } from "./types";

export const tasksAndResourcesTrackerMiddleware = defineMiddleware({
  id: "globals.debug.middlewares.tasksAndResourcesTracker",
  dependencies: {
    logger: globalResources.logger,
    debugConfig,
    store: globalResources.store,
  },
  run: async ({ task, resource, next }, { logger, debugConfig, store }) => {
    const start = Date.now();

    // Task handling
    if (task) {
      if (!store || store.isLocked) {
        return next(task.input);
      }

      if (hasSystemOrLifecycleTag(task?.definition)) {
        return next(task.input);
      }

      debugConfig = getConfig(debugConfig, task?.definition);
      let logString = `[task] ${task.definition.id} starting to run`;
      if (debugConfig.logTaskInput) {
        logString += ` with input: \n${safeStringify(task.input)}`;
      }
      await logger.info(logString);

      let result: any;
      try {
        result = await next(task.input);
      } catch (error) {
        logger.error(String(error), {
          error: error as Error,
        });
        throw error;
      }
      const duration = Date.now() - start;

      logString = `[task] ${String(
        task.definition.id
      )} completed in ${duration}ms`;
      if (debugConfig.logTaskResult) {
        logString += ` with result: ${safeStringify(result)}`;
      }
      await logger.info(logString);

      return result;
    }

    // Resource handling
    if (resource) {
      if (!store || store.isLocked) {
        return next(resource.config);
      }

      if (hasSystemOrLifecycleTag(resource?.definition)) {
        return next(resource.config);
      }

      debugConfig = getConfig(debugConfig, resource?.definition);
      let logString = `[resource] ${resource.definition.id} starting to run`;
      if (debugConfig.logResourceConfig) {
        logString += ` with config: ${safeStringify(resource.config)}`;
      }
      await logger.info(logString);
      const result = await next(resource.config);
      const duration = Date.now() - start;
      logString = `[resource] ${String(
        resource.definition.id
      )} initialized in ${duration}ms`;
      if (debugConfig.logResourceResult) {
        logString += ` with result: ${safeStringify(result)}`;
      }
      await logger.info(logString);

      return result;
    }
  },
  meta: {
    tags: [globalTags.system],
  },
});
