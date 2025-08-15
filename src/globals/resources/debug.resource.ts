import { globals } from "../..";
import { defineResource } from "../../define";
import { debugConfig } from "./debug/debugConfig.resource";
import { DebugFriendlyConfig } from "./debug/types";
import { globalEventListener } from "./debug/globalEventListener.task";
import { middlewareBeforeRunListener } from "./debug/middlewareBeforeRun.task";
import { middlewareAfterRunListener } from "./debug/middlewareAfterRun.task";
import { taskOnErrorListener } from "./debug/onErrorListeners.task";
import { resourceOnErrorListener } from "./debug/onErrorListeners.task";
import { tasksAndResourcesTrackerMiddleware } from "./debug/executionTracker.middleware";

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
    tags: [globals.tags.system],
  },
});
