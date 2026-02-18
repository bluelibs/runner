import { defineResource } from "../../define";
import type { Logger } from "../../models/Logger";
import { globalTags } from "../globalTags";

export const loggerResource = defineResource<void, Promise<Logger>>({
  id: "globals.resources.logger",
  meta: {
    // We skip system tag for logger because it's part of the utility toolkit.
    title: "Logger",
    description:
      "Logs all events and errors. This is meant to be used internally for most use-cases. Emits a globals.log event for each log.",
  },
  tags: [globalTags.system],
});
