import { defineResource } from "../../../define";
import { DebugConfig, DebugFriendlyConfig } from "./types";
import { globalTags } from "../../../globals/globalTags";

export const debugConfig = defineResource({
  id: "globals.resources.debug.config",
  meta: {
    title: "Debug Config",
    description: "Debug config. This is used to debug the system.",
    tags: [globalTags.system],
  },
  init: async (config: DebugFriendlyConfig) => {
    let finalConfig: DebugConfig = {
      verbosity: "normal",
    };
    if (typeof config === "object") {
      finalConfig.verbosity = config.verbosity;
    }
    return {
      isVerbose: finalConfig.verbosity === "verbose",
    };
  },
});
