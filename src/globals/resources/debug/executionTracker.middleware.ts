import {
  defineTaskMiddleware,
  defineResourceMiddleware,
} from "../../../define";
import { debugConfig } from "./debugConfig.resource";
import { globalResources } from "../../globalResources";
import { globalTags } from "../../globalTags";
import { getConfig } from "./types";

export const tasksTrackerMiddleware = defineTaskMiddleware({
  id: "globals.debug.middleware.task.executionTracker",
  everywhere: (task) => !globalTags.system.exists(task),
  dependencies: {
    logger: globalResources.logger,
    debugConfig,
    store: globalResources.store,
  },
  run: async ({ task, next }, { logger, debugConfig, store: _store }) => {
    const start = Date.now();
    logger = logger.with({
      source: tasksTrackerMiddleware.id,
    });

    debugConfig = getConfig(debugConfig, task?.definition);
    const taskStartMessage = `Task ${task!.definition.id} is running...`;
    const shouldShowData = debugConfig.logTaskInput && task!.input;
    await logger.info(taskStartMessage, {
      data: shouldShowData ? { input: task!.input } : undefined,
    });

    const result = await next(task!.input);
    const duration = Date.now() - start;
    const taskCompleteMessage = `Task ${
      task!.definition.id
    } completed in ${duration}ms`;
    const shouldShowResult = debugConfig.logTaskOutput && result;
    await logger.info(taskCompleteMessage, {
      data: shouldShowResult ? { result } : undefined,
    });
    return result;
  },
  meta: {
    title: "Execution Tracker",
    description: "Tracks the execution of tasks and resources.",
  },
  tags: [globalTags.system],
});

export const resourcesTrackerMiddleware = defineResourceMiddleware({
  id: "globals.debug.middleware.resource.executionTracker",
  dependencies: {
    logger: globalResources.logger,
    debugConfig,
    store: globalResources.store,
  },
  everywhere: (resource) => !globalTags.system.exists(resource),
  run: async ({ resource, next }, { logger, debugConfig, store: _store }) => {
    const start = Date.now();
    logger = logger.with({
      source: resourcesTrackerMiddleware.id,
    });
    debugConfig = getConfig(debugConfig, resource?.definition);
    const resourceStartMessage = `Resource ${
      resource!.definition.id
    } is initializing...`;

    const isConfigEmpty = Object.keys(resource!.config || {}).length === 0;
    const shouldShowConfig = debugConfig.logResourceConfig && !isConfigEmpty;

    await logger.info(resourceStartMessage, {
      data: shouldShowConfig ? { config: resource!.config } : undefined,
    });

    const result = await next(resource!.config);
    const duration = Date.now() - start;
    const resourceCompleteMessage = `Resource ${String(
      resource!.definition.id,
    )} initialized in ${duration}ms`;
    const shouldShowResult =
      debugConfig.logResourceValue && result !== undefined;

    await logger.info(resourceCompleteMessage, {
      data: shouldShowResult ? { result } : undefined,
    });
    return result;
  },
  meta: {
    title: "Execution Tracker",
    description: "Tracks the execution of tasks and resources.",
  },
  tags: [globalTags.system],
});
