import { defineTag } from "../define";
import { debugTag } from "./resources/debug/debug.tag";
import { tunnelTag } from "./resources/tunnel/tunnel.tag";
import { tunnelPolicyTag } from "./resources/tunnel/tunnel.policy.tag";

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
  excludeFromGlobalHooks: defineTag<{
    metadata?: Record<string, any>;
  }>({
    id: "globals.tags.excludeFromGlobalHooks",
    meta: {
      title: "Exclude Event From Global Hooks",
      description:
        "Marks events that should not be dispatched to global hooks (on: '*').",
    },
  }),
  debug: debugTag,
  tunnel: tunnelTag,
  tunnelPolicy: tunnelPolicyTag,
};
