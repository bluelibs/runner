import { defineMiddleware } from "../../../define";
import { hasSystemTag } from "./utils";
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

      if (hasSystemTag(task?.definition)) {
        return next(task.input);
      }

      debugConfig = getConfig(debugConfig, task?.definition);
      const taskStartMessage = `[task] ${task.definition.id} starting to run`;
      await logger.info(taskStartMessage, {
        data: debugConfig.logTaskInput ? { input: task.input } : undefined,
      });

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

      const taskCompleteMessage = `[task] ${String(
        task.definition.id
      )} completed in ${duration}ms`;
      await logger.info(taskCompleteMessage, {
        data: debugConfig.logTaskResult ? { result } : undefined,
      });

      return result;
    }

    // Resource handling
    if (resource) {
      if (!store || store.isLocked) {
        return next(resource.config);
      }

      if (hasSystemTag(resource?.definition)) {
        return next(resource.config);
      }

      debugConfig = getConfig(debugConfig, resource?.definition);
      const resourceStartMessage = `[resource] ${resource.definition.id} starting to run`;
      await logger.info(resourceStartMessage, {
        data: debugConfig.logResourceConfig
          ? { config: resource.config }
          : undefined,
      });
      const result = await next(resource.config);
      const duration = Date.now() - start;
      const resourceCompleteMessage = `[resource] ${String(
        resource.definition.id
      )} initialized in ${duration}ms`;
      await logger.info(resourceCompleteMessage, {
        data: debugConfig.logResourceResult ? { result } : undefined,
      });

      return result;
    }
  },
  meta: {
    tags: [globalTags.system],
  },
});
