import { defineTask } from "../../../define";
import { globals } from "../../..";

export const taskOnErrorListener = defineTask({
  id: "globals.debug.tasks.taskOnErrorListener",
  on: globals.events.tasks.onError,
  dependencies: {
    logger: globals.resources.logger,
  },
  run: async (event, { logger }) => {
    logger.error(
      `[task] ${String(event.id)} errored out: ${event.data.error.toString()}`
    );
  },
  meta: {
    title: "Task On Error Listener",
    description: "Logs all task on error events.",
    tags: [globals.tags.system],
  },
});

export const resourceOnErrorListener = defineTask({
  id: "globals.debug.tasks.resourceOnErrorListener",
  on: globals.events.resources.onError,
  dependencies: {
    logger: globals.resources.logger,
  },
  run: async (event, { logger }) => {
    logger.error(
      `[resource] ${String(
        event.id
      )} errored out: ${event.data.error.toString()}`
    );
  },
  meta: {
    title: "Resource On Error Listener",
    description: "Logs all resource on error events.",
    tags: [globals.tags.system],
  },
});
