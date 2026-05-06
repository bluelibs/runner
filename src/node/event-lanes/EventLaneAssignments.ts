import type { IEventLaneDefinition } from "../../defs";
import {
  eventLaneApplyToInvalidTargetError,
  eventLaneApplyToTargetNotFoundError,
  eventLaneApplyToTargetTypeError,
  eventLaneAssignmentConflictError,
  eventLaneAssignmentRpcLaneConflictError,
} from "../../errors";
import type { Store } from "../../models/store/Store";
import { collectRpcTopologyLanes } from "../remote-lanes/topologyLanes";
import {
  assignLaneTargetOrThrow,
  assertEventNotAssignedToOtherLane,
  collectCrossLaneApplyToEventIds,
  isRegisteredDefinitionId,
  readTargetId,
  toPublicPredicateCandidate,
  visitLaneApplyTo,
} from "../remote-lanes/laneAssignmentUtils";
import { rpcLanesResource } from "../rpc-lanes/rpcLanes.resource";

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
): void {
  assertEventNotAssignedToOtherLane({
    conflictingEventIds: rpcLaneApplyToEventIds,
    eventId,
    attemptedLaneId: eventLaneId,
    laneIdField: "eventLaneId",
    conflictError: eventLaneAssignmentRpcLaneConflictError,
  });
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
    rpcLanesResource,
    collectRpcTopologyLanes as (
      topology: unknown,
    ) => readonly { applyTo?: unknown }[],
  );
}
