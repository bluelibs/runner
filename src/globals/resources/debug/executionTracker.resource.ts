import { defineResource } from "../../../define";
import { globalTags } from "../../globalTags";
import { loggerResource as logger } from "../logger.resource";
import { taskRunnerResource as taskRunner } from "../taskRunner.resource";
import { middlewareManagerResource as middlewareManager } from "../middlewareManager.resource";
import { debugConfig } from "./debugConfig.resource";
import { getConfig } from "./types";
import { hasSystemTag } from "./utils";
import type { IResourceMiddlewareExecutionInput } from "../../../types/resourceMiddleware";

const id = "globals.debug.resources.executionTracker";

export const executionTrackerResource = defineResource({
  id,
  meta: {
    title: "Execution Tracker",
    description:
      "Tracks task and resource execution using global interceptors without subtree middleware cycles.",
  },
  tags: [globalTags.system],
  dependencies: {
    logger,
    debugConfig,
    taskRunner,
    middlewareManager,
  },
  init: async (_value, deps) => {
    const { logger, debugConfig, taskRunner, middlewareManager } = deps;

    taskRunner.intercept(async (next, input) => {
      const taskDefinition = input.task.definition;
      if (hasSystemTag(taskDefinition)) {
        return next(input);
      }

      const startedAt = Date.now();
      const cfg = getConfig(debugConfig, taskDefinition);
      await logger.info(`Task ${taskDefinition.id} is running...`, {
        source: id,
        data: cfg.logTaskInput ? { input: input.task.input } : undefined,
      });

      try {
        const result = await next(input);
        await logger.info(
          `Task ${taskDefinition.id} completed in ${Date.now() - startedAt}ms`,
          {
            source: id,
            data: cfg.logTaskOutput ? { result } : undefined,
          },
        );
        return result;
      } catch (error) {
        try {
          await logger.error(String(error), { source: id, error });
        } catch {
          // Preserve the original execution error even if logging fails.
        }
        throw error;
      }
    });

    middlewareManager.intercept(
      "resource",
      async (
        next: (
          input: IResourceMiddlewareExecutionInput<any, any>,
        ) => Promise<any>,
        input: IResourceMiddlewareExecutionInput<any, any>,
      ) => {
        const resourceDefinition = input.resource.definition;
        if (hasSystemTag(resourceDefinition)) {
          return next(input);
        }

        const startedAt = Date.now();
        const cfg = getConfig(debugConfig, resourceDefinition);
        const isConfigEmpty =
          Object.keys(input.resource.config || {}).length === 0;

        await logger.info(
          `Resource ${resourceDefinition.id} is initializing...`,
          {
            source: id,
            data:
              cfg.logResourceConfig && !isConfigEmpty
                ? { config: input.resource.config }
                : undefined,
          },
        );

        try {
          const result = await next(input);
          await logger.info(
            `Resource ${resourceDefinition.id} initialized in ${
              Date.now() - startedAt
            }ms`,
            {
              source: id,
              data:
                cfg.logResourceValue && result !== undefined
                  ? { result }
                  : undefined,
            },
          );
          return result;
        } catch (error) {
          try {
            await logger.error(String(error), { source: id, error });
          } catch {
            // Preserve the original resource initialization error.
          }
          throw error;
        }
      },
    );
  },
});
