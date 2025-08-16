import { defineTag } from "../../../define";
import { DebugFriendlyConfig } from "./types";

export const debugTag = defineTag<DebugFriendlyConfig>({
  id: "globals.tags.debug",
  meta: {
    title: "Debug",
    description:
      "Debug-specific tags. Used for filtering out noise when you're focusing on your application.",
  },
});
