import { defineResource } from "../../../define";
import { debugConfig } from "./debugConfig.resource";
import { DebugFriendlyConfig } from "./types";
import { globalEventListener } from "./globalEventListener.task";
import { middlewareBeforeRunListener } from "./middlewareBeforeRun.task";
import { middlewareAfterRunListener } from "./middlewareAfterRun.task";
import { taskOnErrorListener } from "./onErrorListeners.task";
import { resourceOnErrorListener } from "./onErrorListeners.task";
import { tasksAndResourcesTrackerMiddleware } from "./executionTracker.middleware";
import { globalTags } from "../../globalTags";

export const debugResource = defineResource({
  id: "globals.resources.debug",
  register: (config: DebugFriendlyConfig) => [
    debugConfig.with(config),
    tasksAndResourcesTrackerMiddleware.everywhere(),
    globalEventListener,
    middlewareBeforeRunListener,
    middlewareAfterRunListener,
    taskOnErrorListener,
    resourceOnErrorListener,
  ],
  meta: {
    title: "Debug",
    description: "Debug resource. This is used to debug the system.",
    tags: [globalTags.system],
  },
});
