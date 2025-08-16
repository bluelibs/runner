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
  excludeFromGlobalListeners: defineTag<{
    metadata?: Record<string, any>;
  }>({
    id: "globals.tags.excludeFromGlobalListeners",
    meta: {
      title: "Exclude Event From Global Listeners",
      description:
        "Marks events that should not be dispatched to global listeners (on: '*').",
    },
  }),
  debug: debugTag,
};
