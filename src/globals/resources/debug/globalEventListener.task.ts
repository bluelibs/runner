import { defineTask } from "../../../define";
import { globalResources } from "../../globalResources";
import { globalTags } from "../../globalTags";
import { safeStringify } from "./utils";

export const globalEventListener = defineTask({
  id: "globals.debug.tasks.globalEventListener",
  on: "*",
  dependencies: {
    logger: globalResources.logger,
  },
  run: async (event, { logger }) => {
    const systemTag = globalTags.system.extract(event);
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
    tags: [globalTags.system],
  },
});
