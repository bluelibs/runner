import { defineMiddleware } from "../../../define";
import { globals } from "../../..";
import { safeStringify } from "./utils";
import { debugConfig } from "./debugConfig.resource";

export const tasksAndResourcesTrackerMiddleware = defineMiddleware({
  id: "globals.debug.middlewares.tasksAndResourcesTracker",
  dependencies: {
    logger: globals.resources.logger,
    debugConfig,
  },
  run: async ({ task, resource, next }, { logger }) => {
    const start = Date.now();
    if (task) {
      logger.info(
        `[task] ${String(task.definition.id)} with input: \n${safeStringify(
          task.input
        )}`
      );
      const result = await next(task.input);
      const duration = Date.now() - start;
      logger.info(
        `[task] ${String(
          task.definition.id
        )} completed with result:\n ${safeStringify(result)} in ${duration}ms`
      );
    }
    if (resource) {
      logger.info(
        `[resource] ${String(
          resource.definition.id
        )} with config: ${safeStringify(resource.config)}`
      );
      const result = await next();
      const duration = Date.now() - start;
      logger.info(
        `[resource] ${String(
          resource.definition.id
        )} initialized with result: ${safeStringify(result)} in ${duration}ms`
      );
    }
  },
  meta: {
    tags: [globals.tags.system],
  },
});
