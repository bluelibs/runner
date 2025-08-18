import { defineMiddleware } from "../../../define";
import { hasSystemTag } from "./utils";
import { debugConfig } from "./debugConfig.resource";
import { globalResources } from "../../globalResources";
import { globalTags } from "../../globalTags";
import { getConfig } from "./types";

export const tasksAndResourcesTrackerMiddleware = defineMiddleware({
  id: "debug.middleware.tracker",
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
      const shouldShowData = debugConfig.logTaskInput && task.input;
      await logger.info(taskStartMessage, {
        data: shouldShowData ? { input: task.input } : undefined,
        source: "debug.middleware.tracker",
      });

      try {
        const result = await next(task.input);
        const duration = Date.now() - start;
        const taskCompleteMessage = `Task ${task.definition.id} completed in ${duration}ms`;
        const shouldShowResult = debugConfig.logTaskOutput && result;
        await logger.info(taskCompleteMessage, {
          data: shouldShowResult ? { result } : undefined,
          source: "debug.middleware.tracker",
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
      const shouldShowConfig =
        debugConfig.logResourceConfig &&
        Object.keys(resource.config || {}).length > 0;
      await logger.info(resourceStartMessage, {
        data: shouldShowConfig ? { config: resource.config } : undefined,
        source: "debug.middleware.tracker",
      });

      try {
        const result = await next(resource.config);
        const duration = Date.now() - start;
        const resourceCompleteMessage = `Resource ${String(
          resource.definition.id,
        )} initialized in ${duration}ms`;
        const shouldShowResult =
          debugConfig.logResourceValue && result !== undefined;

        await logger.info(resourceCompleteMessage, {
          data: shouldShowResult ? { result } : undefined,
          source: "debug.middleware.tracker",
        });
        return result;
      } catch (error) {
        // await logger.error(error);
        throw error;
      }
    }
  },
  meta: {
    tags: [globalTags.system],
  },
});
