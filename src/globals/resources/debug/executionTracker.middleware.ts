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
      //   if (hasSystemTag(task?.definition)) {
      //     return next(task.input);
      //   }

      debugConfig = getConfig(debugConfig, task?.definition);
      const taskStartMessage = `Task ${task.definition.id} is running...`;
      await logger.info(taskStartMessage, {
        data: debugConfig.logTaskInput ? { input: task.input } : undefined,
      });

      try {
        const result = await next(task.input);
        const duration = Date.now() - start;
        const taskCompleteMessage = `Task ${task.definition.id} completed in ${duration}ms`;
        await logger.info(taskCompleteMessage, {
          data: debugConfig.logTaskOutput ? { result } : undefined,
        });
        return result;
      } catch (error) {
        // Ensure error is visible in logs as a message
        await logger.error(error);
        throw error;
      }
    }

    // Resource handling
    if (resource) {
      debugConfig = getConfig(debugConfig, resource?.definition);
      const resourceStartMessage = `Resource ${resource.definition.id} is initializing...`;
      await logger.info(resourceStartMessage, {
        data: debugConfig.logResourceConfig
          ? { config: resource.config }
          : undefined,
      });
      try {
        const result = await next(resource.config);
        const duration = Date.now() - start;
        const resourceCompleteMessage = `Resource ${String(
          resource.definition.id
        )} initialized in ${duration}ms`;
        await logger.info(resourceCompleteMessage, {
          data: debugConfig.logResourceValue ? { result } : undefined,
        });
        return result;
      } catch (error) {
        await logger.error(error);
        throw error;
      }
    }
  },
  meta: {
    tags: [globalTags.system],
  },
});
