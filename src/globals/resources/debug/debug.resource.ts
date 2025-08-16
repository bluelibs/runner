import { defineResource } from "../../../define";
import { debugConfig } from "./debugConfig.resource";
import { DebugFriendlyConfig } from "./types";
import { globalEventListener } from "./globalEvent.hook";
import { tasksAndResourcesTrackerMiddleware } from "./executionTracker.middleware";
import { globalTags } from "../../globalTags";
import { hookCompletedListener, hookTriggeredListener } from "./hook.hook";

export const debugResource = defineResource({
  id: "globals.resources.debug",
  register: (config: DebugFriendlyConfig) => {
    return [
      debugConfig.with(config),
      globalEventListener,
      hookTriggeredListener,
      hookCompletedListener,
      tasksAndResourcesTrackerMiddleware.everywhere(),
    ];
  },
  meta: {
    title: "Debug",
    description: "Debug resource. This is used to debug the system.",
    tags: [globalTags.system],
  },
});
