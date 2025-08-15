import { defineTask } from "../../../define";
import { globals } from "../../../";
import { safeStringify } from "./utils";

export const globalEventListener = defineTask({
  id: "globals.debug.tasks.globalEventListener",
  on: "*",
  dependencies: {
    logger: globals.resources.logger,
  },
  run: async (event, { logger }) => {
    const systemTag = globals.tags.system.extract(event);
    if (systemTag) {
      return;
    }

    logger.info(
      `[event] ${String(event.id)} with payload: \n${safeStringify(event.data)}`
    );
  },
  meta: {
    title: "Non-system Event Logger",
    description: "Logs all non-system events.",
    tags: [globals.tags.system],
  },
});
