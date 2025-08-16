import { defineResource } from "../../../define";
import { DebugFriendlyConfig, getConfig } from "./types";
import { globalTags } from "../../../globals/globalTags";

export const debugConfig = defineResource({
  id: "globals.resources.debug.config",
  meta: {
    title: "Debug Config",
    description: "Debug config. This is used to debug the system.",
    tags: [globalTags.system],
  },
  init: async (config: DebugFriendlyConfig) => {
    const myConfig = getConfig(config);

    return myConfig;
  },
});
