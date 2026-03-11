import { defineTag } from "../definers/defineTag";
import { markFrameworkDefinition } from "../definers/markFrameworkDefinition";
import type {
  IEventLaneDefinition,
  IResource,
  IRpcLaneDefinition,
} from "../defs";
import { cronTag } from "./cron/cron.tag";
import { debugTag } from "./resources/debug/debug.tag";

const internalTag = defineTag<{
  metadata?: Record<string, any>;
}>(
  markFrameworkDefinition({
    id: "system.tags.internal",
    meta: {
      title: "System Internal",
      description:
        "Marks framework-owned internals and infrastructure definitions.",
    },
  }),
);

const globalTagsBase = {
  system: internalTag,
  excludeFromGlobalHooks: defineTag<{
    metadata?: Record<string, any>;
  }>(
    markFrameworkDefinition({
      id: "runner.tags.excludeFromGlobalHooks",
      targets: ["events"] as const,
      meta: {
        title: "Exclude Event From Global Hooks",
        description:
          "Marks events that should not be dispatched to global hooks (on: '*').",
      },
    }),
  ),
  eventLane: defineTag<{
    lane: IEventLaneDefinition;
  }>(
    markFrameworkDefinition({
      id: "runner.tags.eventLane",
      targets: ["events"] as const,
      meta: {
        title: "Event Lane",
        description:
          "Routes tagged events to the configured Event Lane binding (reference-based).",
      },
    }),
  ),
  rpcLane: defineTag<{
    lane: IRpcLaneDefinition;
  }>(
    markFrameworkDefinition({
      id: "runner.tags.rpcLane",
      targets: ["tasks", "events"] as const,
      meta: {
        title: "RPC Lane",
        description:
          "Routes tagged tasks/events through rpcLane topology bindings and profile rules.",
      },
    }),
  ),
  rpcLanes: defineTag<{ metadata?: Record<string, any> }>(
    markFrameworkDefinition({
      id: "runner.tags.rpcLanes",
      targets: ["resources"] as const,
      meta: {
        title: "RPC Lanes",
        description:
          "Marks resources that apply rpcLane topology and optional server exposure.",
      },
    }),
  ),
  debug: debugTag,
  cron: cronTag,
  authValidator: defineTag(
    markFrameworkDefinition({
      id: "runner.tags.authValidator",
      targets: ["tasks"] as const,
      meta: {
        title: "Auth Validator",
        description:
          "Marks tasks that validate HTTP requests for remote lane exposure authentication.",
      },
    }),
  ),
  failWhenUnhealthy: defineTag<
    ReadonlyArray<string | IResource<any, any, any, any, any>>
  >(
    markFrameworkDefinition({
      id: "runner.tags.failWhenUnhealthy",
      targets: ["tasks"] as const,
      meta: {
        title: "Fail When Unhealthy",
        description:
          "Blocks task execution when any selected resource currently reports unhealthy health status.",
      },
    }),
  ),
};
export const globalTags = globalTagsBase;
