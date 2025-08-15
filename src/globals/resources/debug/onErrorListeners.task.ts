import { defineTask } from "../../../define";
import { globals } from "../../..";
import { globalEvents } from "../../globalEvents";
import { globalResources } from "../../globalResources";
import { globalTags } from "../../globalTags";

export const taskOnErrorListener = defineTask({
  id: "globals.debug.tasks.taskOnErrorListener",
  on: globalEvents.tasks.onError,
  dependencies: {
    logger: globalResources.logger,
  },
  run: async (event, { logger }) => {
    await logger.error(
      `[task] ${String(event.id)} errored out: ${event.data.error.toString()}`
    );
  },
  meta: {
    title: "Task On Error Listener",
    description: "Logs all task on error events.",
    tags: [globalTags.system],
  },
});

export const resourceOnErrorListener = defineTask({
  id: "globals.debug.tasks.resourceOnErrorListener",
  on: globalEvents.resources.onError,
  dependencies: {
    logger: globalResources.logger,
  },
  run: async (event, { logger }) => {
    await logger.error(
      `[resource] ${String(
        event.id
      )} errored out: ${event.data.error.toString()}`
    );
  },
  meta: {
    title: "Resource On Error Listener",
    description: "Logs all resource on error events.",
    tags: [globalTags.system],
  },
});

export const middlewareOnErrorListener = defineTask({
  id: "globals.debug.tasks.middlewareOnErrorListener",
  on: globalEvents.middlewares.onError,
  dependencies: {
    logger: globalResources.logger,
  },
  run: async (event, { logger }) => {
    await logger.error(
      `[middleware] ${String(
        event.id
      )} errored out: ${event.data.error.toString()}`
    );
  },
  meta: {
    title: "Middleware On Error Listener",
    description: "Logs all middleware on error events.",
    tags: [globalTags.system],
  },
});
