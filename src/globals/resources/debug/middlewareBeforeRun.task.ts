import { defineTask } from "../../../define";
import { globalEvents } from "../../../globals/globalEvents";
import { globals } from "../../..";

export const middlewareBeforeRunListener = defineTask({
  id: "globals.debug.tasks.middlewareBeforeRunListener",
  on: globalEvents.middlewares.beforeRun,
  dependencies: {
    logger: globals.resources.logger,
  },
  run: async (event, { logger }) => {
    const data = event.data;
    const context = data.task ? "task" : "resource";
    const id = data.task
      ? data.task.definition.id
      : data.resource.definition.id;
    const middlewareId = event.data.middleware.id;

    logger.info(
      `[middleware][${context}] ${String(
        middlewareId
      )} starting wrapping ${String(id)}`
    );
  },
  meta: {
    tags: [globals.tags.system],
  },
});
