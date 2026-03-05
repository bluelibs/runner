import type { IEventLaneDefinition } from "../../defs";
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
import {
  readTargetId,
  isRegisteredDefinitionId,
  collectCrossLaneApplyToEventIds,
} from "../remote-lanes/laneAssignmentUtils";

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
  const targetId = readTargetId(
    target,
    laneId,
    eventLaneApplyToInvalidTargetError,
  );
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

function collectRpcLaneApplyToEventIds(store: Store): Set<string> {
  return collectCrossLaneApplyToEventIds(
    store,
    RPC_LANES_RESOURCE_ID,
    collectRpcTopologyLanes as (
      topology: unknown,
    ) => readonly { applyTo?: unknown }[],
  );
}
