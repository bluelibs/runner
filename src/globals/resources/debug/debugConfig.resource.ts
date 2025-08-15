import { defineResource } from "../../../define";
import { DebugConfig, DebugFriendlyConfig, defaultDebugConfig } from "./types";
import { globalTags } from "../../../globals/globalTags";

export const debugConfig = defineResource({
  id: "globals.resources.debug.config",
  meta: {
    title: "Debug Config",
    description: "Debug config. This is used to debug the system.",
    tags: [globalTags.system],
  },
  init: async (config: DebugFriendlyConfig) => {
    let finalConfig: DebugConfig = defaultDebugConfig;
    if (typeof config === "object") {
      finalConfig = {
        ...defaultDebugConfig,
        ...config,
      };
    }
    return finalConfig;
  },
});
