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
  assignLaneTargetOrThrow,
  readTargetId,
  isRegisteredDefinitionId,
  collectCrossLaneApplyToEventIds,
  toPublicPredicateCandidate,
  visitLaneApplyTo,
} from "../remote-lanes/laneAssignmentUtils";
import { RPC_LANES_RESOURCE_ID } from "../rpc-lanes/rpcLanes.resource";

export interface EventLaneRoute {
  lane: IEventLaneDefinition;
}

export function resolveEventLaneAssignments(
  store: Store,
  lanes: readonly IEventLaneDefinition[],
): Map<string, EventLaneRoute> {
  const laneByEventId = new Map<string, IEventLaneDefinition>();
  const rpcLaneApplyToEventIds = collectRpcLaneApplyToEventIds(store);

  for (const lane of lanes) {
    const applyTo = lane.applyTo;
    if (applyTo === undefined) continue;

    visitLaneApplyTo({
      store,
      laneId: lane.id,
      applyTo,
      invalidTargetError: eventLaneApplyToInvalidTargetError,
      predicateSources: store.events.values(),
      toPredicateCandidate: (eventEntry) =>
        toPublicPredicateCandidate(store, eventEntry.event),
      onPredicateMatch: (eventEntry) => {
        assignEventToLane({
          laneByEventId,
          rpcLaneApplyToEventIds,
          eventId: eventEntry.event.id,
          lane,
          store,
        });
      },
      resolveTarget: resolveEventLaneTarget,
      onResolvedTarget: (eventId) => {
        assignEventToLane({
          laneByEventId,
          rpcLaneApplyToEventIds,
          eventId,
          lane,
          store,
        });
      },
    });
  }

  for (const eventEntry of store.events.values()) {
    const laneConfig = globalTags.eventLane.extract(eventEntry.event.tags);
    if (!laneConfig) {
      continue;
    }

    const eventId = eventEntry.event.id;
    if (laneByEventId.has(eventId)) {
      // applyTo is authoritative; tags only apply when no applyTo matched.
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

    laneByEventId.set(eventId, laneConfig.lane);
  }

  return new Map(
    Array.from(laneByEventId.entries(), ([eventId, lane]) => [
      eventId,
      { lane },
    ]),
  );
}

function assignEventToLane(options: {
  laneByEventId: Map<string, IEventLaneDefinition>;
  rpcLaneApplyToEventIds: Set<string>;
  eventId: string;
  lane: IEventLaneDefinition;
  store: Store;
}): void {
  const { laneByEventId, rpcLaneApplyToEventIds, eventId, lane, store } =
    options;
  assertEventIsNotExplicitlyAssignedToRpcLane(
    rpcLaneApplyToEventIds,
    eventId,
    lane.id,
    store,
  );

  assignLaneTargetOrThrow({
    assignments: laneByEventId,
    targetId: eventId,
    lane,
    store,
    targetField: "eventId",
    conflictError: eventLaneAssignmentConflictError,
  });
}

function assertEventIsNotExplicitlyAssignedToRpcLane(
  rpcLaneApplyToEventIds: Set<string>,
  eventId: string,
  eventLaneId: string,
  _store: Store,
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
  const eventEntry = store.events.get(targetId);
  if (eventEntry) {
    return eventEntry.event.id;
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
