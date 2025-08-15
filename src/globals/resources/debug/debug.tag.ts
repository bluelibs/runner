import { defineTag } from "../../../define";
import { DebugConfig } from "./types";

export type DebugTag = {
  logInput: boolean;
  logOutput: boolean;
};

export const debugTag = defineTag<{
  config?: Partial<DebugConfig>;
}>({
  id: "globals.tags.debug",
  meta: {
    title: "Debug",
    description:
      "Debug-specific tags. Used for filtering out noise when you're focusing on your application.",
  },
});
