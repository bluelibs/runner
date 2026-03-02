import type { IEventLaneDefinition, IRpcLanesTopology } from "../../defs";
import {
  eventLaneApplyToInvalidTargetError,
  eventLaneApplyToTargetNotFoundError,
  eventLaneApplyToTargetTypeError,
  eventLaneAssignmentConflictError,
  eventLaneAssignmentRpcLaneConflictError,
} from "../../errors";
import { globalTags } from "../../globals/globalTags";
import type { Store } from "../../models/Store";
import { collectRpcTopologyLanes } from "../remote-lanes/topologyLanes";

const RPC_LANES_RESOURCE_ID = "platform.node.resources.rpcLanes";

export interface EventLaneRoute {
  lane: IEventLaneDefinition;
}

export function resolveEventLaneAssignments(
  store: Store,
  lanes: readonly IEventLaneDefinition[],
): Map<string, EventLaneRoute> {
  const routesByEventId = new Map<string, EventLaneRoute>();
  const rpcLaneApplyToEventIds = collectRpcLaneApplyToEventIds(store);

  for (const lane of lanes) {
    const applyTo = lane.applyTo;
    if (applyTo === undefined) continue;

    if (typeof applyTo === "function") {
      for (const eventEntry of store.events.values()) {
        if (!applyTo(eventEntry.event)) continue;
        const eventId = eventEntry.event.id;
        assertEventIsNotExplicitlyAssignedToRpcLane(
          rpcLaneApplyToEventIds,
          eventId,
          lane.id,
        );

        const current = routesByEventId.get(eventId);
        if (current && current.lane.id !== lane.id) {
          eventLaneAssignmentConflictError.throw({
            eventId,
            currentLaneId: current.lane.id,
            attemptedLaneId: lane.id,
          });
        }

        if (!current) {
          routesByEventId.set(eventId, { lane });
        }
      }
      continue;
    }

    if (!Array.isArray(applyTo)) {
      eventLaneApplyToInvalidTargetError.throw({ laneId: lane.id });
    }

    for (const target of applyTo) {
      const eventId = resolveEventLaneTarget(target, lane.id, store);
      assertEventIsNotExplicitlyAssignedToRpcLane(
        rpcLaneApplyToEventIds,
        eventId,
        lane.id,
      );

      const current = routesByEventId.get(eventId);
      if (current && current.lane.id !== lane.id) {
        eventLaneAssignmentConflictError.throw({
          eventId,
          currentLaneId: current.lane.id,
          attemptedLaneId: lane.id,
        });
      }

      if (!current) {
        routesByEventId.set(eventId, { lane });
      }
    }
  }

  for (const eventEntry of store.events.values()) {
    const laneConfig = globalTags.eventLane.extract(eventEntry.event.tags);
    if (!laneConfig) {
      continue;
    }

    const eventId = eventEntry.event.id;
    const existing = routesByEventId.get(eventId);
    if (existing) {
      // applyTo is authoritative; tags only apply when no applyTo matched.
      if (existing.lane.id === laneConfig.lane.id) {
        // Same lane, no-op.
      }
      continue;
    }

    // If another system explicitly applies this event, tag-based routing is ignored.
    if (rpcLaneApplyToEventIds.has(eventId)) {
      continue;
    }

    // Without explicit applyTo, IoC tags must not assign the same event to both systems.
    if (globalTags.rpcLane.exists(eventEntry.event.tags)) {
      eventLaneAssignmentRpcLaneConflictError.throw({
        eventId,
        eventLaneId: laneConfig.lane.id,
      });
    }

    routesByEventId.set(eventId, {
      lane: laneConfig.lane,
    });
  }

  return routesByEventId;
}

function assertEventIsNotExplicitlyAssignedToRpcLane(
  rpcLaneApplyToEventIds: Set<string>,
  eventId: string,
  eventLaneId: string,
): void {
  if (rpcLaneApplyToEventIds.has(eventId)) {
    eventLaneAssignmentRpcLaneConflictError.throw({
      eventId,
      eventLaneId,
    });
  }
}

function resolveEventLaneTarget(
  target: unknown,
  laneId: string,
  store: Store,
): string {
  const targetId = readTargetId(target, laneId);
  if (store.events.has(targetId)) {
    return targetId;
  }

  if (isRegisteredDefinitionId(store, targetId)) {
    return eventLaneApplyToTargetTypeError.throw({
      laneId,
      targetId,
    });
  }

  return eventLaneApplyToTargetNotFoundError.throw({
    laneId,
    targetId,
  });
}

function readTargetId(target: unknown, laneId: string): string {
  if (typeof target === "string" && target.length > 0) {
    return target;
  }

  if (
    target &&
    typeof target === "object" &&
    typeof (target as { id?: unknown }).id === "string" &&
    (target as { id: string }).id.length > 0
  ) {
    return (target as { id: string }).id;
  }

  return eventLaneApplyToInvalidTargetError.throw({
    laneId,
  });
}

function isRegisteredDefinitionId(store: Store, id: string): boolean {
  const collections = [
    store.tasks,
    store.resources,
    store.hooks,
    store.taskMiddlewares,
    store.resourceMiddlewares,
    store.errors,
    store.tags,
    store.asyncContexts,
  ];

  for (const collection of collections) {
    if (collection.has(id)) {
      return true;
    }
  }

  return false;
}

function collectRpcLaneApplyToEventIds(store: Store): Set<string> {
  const eventIds = new Set<string>();
  const rpcLanesEntry = store.resources.get(RPC_LANES_RESOURCE_ID);
  const topology = (rpcLanesEntry?.config as { topology?: IRpcLanesTopology })
    ?.topology;
  if (!topology) {
    return eventIds;
  }

  const lanes = collectRpcTopologyLanes(topology);
  for (const lane of lanes) {
    const applyTo = lane.applyTo;
    if (applyTo === undefined) continue;

    if (typeof applyTo === "function") {
      for (const eventEntry of store.events.values()) {
        if (applyTo(eventEntry.event)) {
          eventIds.add(eventEntry.event.id);
        }
      }
      continue;
    }

    if (!Array.isArray(applyTo)) continue;
    for (const target of applyTo) {
      const targetId = extractTargetId(target);
      if (typeof targetId === "string" && store.events.has(targetId)) {
        eventIds.add(targetId);
      }
    }
  }

  return eventIds;
}

function extractTargetId(target: unknown): string | undefined {
  if (typeof target === "string") {
    return target;
  }

  if (
    target &&
    typeof target === "object" &&
    typeof (target as { id?: unknown }).id === "string"
  ) {
    return (target as { id: string }).id;
  }

  return undefined;
}
