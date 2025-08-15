import { defineTag } from "../define";
import { DebugConfig } from "./resources/debug";
import { debugTag } from "./resources/debug/debug.tag";

export const globalTags = {
  system: defineTag<{
    metadata?: Record<string, any>;
  }>({
    id: "globals.tags.system",
    meta: {
      title: "System",
      description:
        "System-wide tags. Used for filtering out noise when you're focusing on your application.",
    },
  }),
  lifecycle: defineTag<{
    metadata?: Record<string, any>;
  }>({
    id: "globals.tags.lifecycle",
    meta: {
      title: "Lifecycle",
      description:
        "Lifecycle tags. This relates to before initialization, before running, on error and after elements.",
    },
  }),
  debug: debugTag,
};
