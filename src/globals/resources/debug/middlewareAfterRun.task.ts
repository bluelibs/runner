import { globals } from "../../..";
import { defineTask } from "../../../define";
import { globalEvents } from "../../globalEvents";
import { globalResources } from "../../globalResources";
import { globalTags } from "../../globalTags";

export const middlewareAfterRunListener = defineTask({
  id: "globals.debug.tasks.middlewareAfterRunListener",
  on: globalEvents.middlewares.afterRun,
  dependencies: {
    logger: globalResources.logger,
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
      )} finished wrapping ${String(id)}`
    );
  },
  meta: {
    tags: [globalTags.system],
  },
});
