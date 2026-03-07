import { defineFrameworkTag } from "../definers/frameworkDefinition";
import { frameworkTag as tagBuilder } from "../definers/builders/tag";
import type { IEventLaneDefinition, IRpcLaneDefinition } from "../defs";
import { cronTag } from "./cron/cron.tag";
import { debugTag } from "./resources/debug/debug.tag";

const internalTag = defineFrameworkTag<{
  metadata?: Record<string, any>;
}>({
  id: "system.tags.internal",
  meta: {
    title: "System Internal",
    description:
      "Marks framework-owned internals and infrastructure definitions.",
  },
});

const globalTagsBase = {
  system: internalTag,
  /** @deprecated Use `globalTags.system`. Kept for backward compatibility. */
  internal: internalTag,
  excludeFromGlobalHooks: defineFrameworkTag<{
    metadata?: Record<string, any>;
  }>({
    id: "runner.tags.excludeFromGlobalHooks",
    meta: {
      title: "Exclude Event From Global Hooks",
      description:
        "Marks events that should not be dispatched to global hooks (on: '*').",
    },
  }),
  eventLane: tagBuilder<{
    lane: IEventLaneDefinition;
  }>("runner.tags.eventLane")
    .for("events")
    .meta({
      title: "Event Lane",
      description:
        "Routes tagged events to the configured Event Lane binding (reference-based).",
    })
    .build(),
  rpcLane: tagBuilder<{
    lane: IRpcLaneDefinition;
  }>("runner.tags.rpcLane")
    .for(["tasks", "events"])
    .meta({
      title: "RPC Lane",
      description:
        "Routes tagged tasks/events through rpcLane topology bindings and profile rules.",
    })
    .build(),
  rpcLanes: tagBuilder<{ metadata?: Record<string, any> }>(
    "runner.tags.rpcLanes",
  )
    .for("resources")
    .meta({
      title: "RPC Lanes",
      description:
        "Marks resources that apply rpcLane topology and optional server exposure.",
    })
    .build(),
  debug: debugTag,
  cron: cronTag,
  authValidator: tagBuilder("runner.tags.authValidator")
    .for("tasks")
    .meta({
      title: "Auth Validator",
      description:
        "Marks tasks that validate HTTP requests for remote lane exposure authentication.",
    })
    .build(),
};
export const globalTags = globalTagsBase;
