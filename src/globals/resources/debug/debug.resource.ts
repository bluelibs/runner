import { defineResource } from "../../../define";
import { debugConfig } from "./debugConfig.resource";
import { DebugFriendlyConfig } from "./types";
import { globalEventListener } from "./globalEvent.listener";
import { middlewareBeforeRunListener } from "./middlewareBeforeRun.listener";
import { middlewareAfterRunListener } from "./middlewareAfterRun.listener";
import {
  middlewareOnErrorListener,
  taskOnErrorListener,
} from "./onErrorListeners.task";
import { resourceOnErrorListener } from "./onErrorListeners.task";
import { tasksAndResourcesTrackerMiddleware } from "./executionTracker.middleware";
import { globalTags } from "../../globalTags";

export const debugResource = defineResource({
  id: "globals.resources.debug",
  register: (config: DebugFriendlyConfig) => {
    return [
      debugConfig.with(config),
      globalEventListener,
      tasksAndResourcesTrackerMiddleware.everywhere(),
      // middlewareBeforeRunListener,
      // middlewareAfterRunListener,
      // taskOnErrorListener,
      // resourceOnErrorListener,
      // middlewareOnErrorListener,
    ];
  },
  meta: {
    title: "Debug",
    description: "Debug resource. This is used to debug the system.",
    tags: [globalTags.system],
  },
});
