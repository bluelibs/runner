import { defineTag } from "../define";
import { tag as tagBuilder } from "../definers/builders/tag";
import type { IEventLaneDefinition, IRpcLaneDefinition } from "../defs";
import { cronTag } from "./cron/cron.tag";
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
  eventLane: tagBuilder<{
    lane: IEventLaneDefinition;
  }>("globals.tags.eventLane")
    .for("events")
    .meta({
      title: "Event Lane",
      description:
        "Routes tagged events to the configured Event Lane binding (reference-based).",
    })
    .build(),
  rpcLane: tagBuilder<{
    lane: IRpcLaneDefinition;
  }>("globals.tags.rpcLane")
    .for(["tasks", "events"])
    .meta({
      title: "RPC Lane",
      description:
        "Routes tagged tasks/events through rpcLane topology bindings and profile rules.",
    })
    .build(),
  rpcLanes: tagBuilder<{ metadata?: Record<string, any> }>(
    "globals.tags.rpcLanes",
  )
    .for("resources")
    .meta({
      title: "RPC Lanes",
      description:
        "Marks resources that apply rpcLane topology and optional server exposure.",
    })
    .build(),
  containerInternals: defineTag<{
    metadata?: Record<string, any>;
  }>({
    id: "globals.tags.containerInternals",
    meta: {
      title: "Container Internals",
      description:
        "Marks privileged container resources (store, taskRunner, middlewareManager, eventManager, runtime) so isolation boundaries can deny access by tag.",
    },
  }),
  debug: debugTag,
  cron: cronTag,
  tunnel: tunnelTag,
  tunnelTaskPolicy: tunnelTaskPolicyTag,
  authValidator: tagBuilder("globals.tags.authValidator")
    .for("tasks")
    .meta({
      title: "Auth Validator",
      description:
        "Marks tasks that validate HTTP requests for tunnel authentication.",
    })
    .build(),
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
