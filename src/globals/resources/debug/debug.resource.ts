import { defineResource } from "../../../define";
import { debugConfig } from "./debugConfig.resource";
import { DebugFriendlyConfig } from "./types";
import { globalEventListener } from "./globalEvent.hook";
import {
  tasksTrackerMiddleware,
  resourcesTrackerMiddleware,
} from "./executionTracker.middleware";
import { globalTags } from "../../globalTags";
import { middlewareInterceptorResource } from "./middleware.hook";
import { hookInterceptorResource } from "./hook.hook";

export const debugResource = defineResource({
  id: "globals.resources.debug",
  register: (config: DebugFriendlyConfig) => {
    return [
      debugConfig.with(config),
      globalEventListener,
      middlewareInterceptorResource,
      hookInterceptorResource,
      tasksTrackerMiddleware,
      resourcesTrackerMiddleware,
    ];
  },
  meta: {
    title: "Debug",
    description: "Debug resource. This is used to debug the system.",
  },
  tags: [globalTags.system],
});
