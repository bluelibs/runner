import { defineTag } from "../define";
import { debugTag } from "./resources/debug/debug.tag";
import { tunnelTag } from "./resources/tunnel/tunnel.tag";
import { tunnelTaskPolicyTag } from "./resources/tunnel/tunnel.policy.tag";

const globalTagsBase = {
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
  tunnelTaskPolicy: tunnelTaskPolicyTag,
  authValidator: defineTag({
    id: "globals.tags.authValidator",
    meta: {
      title: "Auth Validator",
      description:
        "Marks tasks that validate HTTP requests for tunnel authentication.",
    },
  }),
};

type GlobalTags = typeof globalTagsBase & {
  /** @deprecated Use globals.tags.tunnelTaskPolicy instead. */
  tunnelPolicy: typeof tunnelTaskPolicyTag;
};

export const globalTags = globalTagsBase as GlobalTags;

Object.defineProperty(globalTags, "tunnelPolicy", {
  get: () => globalTags.tunnelTaskPolicy,
  enumerable: false,
  configurable: false,
});
