import { defineFrameworkResource } from "../../../definers/frameworkDefinition";
import { debugConfig } from "./debugConfig.resource";
import { DebugFriendlyConfig } from "./types";
import { globalEventListener } from "./globalEvent.hook";
import { globalTags } from "../../globalTags";
import { middlewareInterceptorResource } from "./middleware.hook";
import { hookInterceptorResource } from "./hook.hook";
import { executionTrackerResource } from "./executionTracker.resource";

export const debugResource = defineFrameworkResource({
  id: "runner.debug",
  register: (config: DebugFriendlyConfig) => {
    return [
      debugConfig.with(config),
      globalEventListener,
      middlewareInterceptorResource,
      hookInterceptorResource,
      executionTrackerResource,
    ];
  },
  meta: {
    title: "Debug",
    description: "Debug resource. This is used to debug the system.",
  },
  tags: [globalTags.system],
});
