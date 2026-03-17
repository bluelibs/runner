import type { IRpcLaneDefinition } from "../../defs";
import {
  rpcLaneApplyToInvalidTargetError,
  rpcLaneApplyToTargetNotFoundError,
  rpcLaneApplyToTargetTypeError,
  rpcLaneAssignmentEventLaneConflictError,
  rpcLaneEventAssignmentConflictError,
  rpcLaneTaskAssignmentConflictError,
} from "../../errors";
import { globalTags } from "../../globals/globalTags";
import type { Store } from "../../models/Store";
import { collectEventTopologyLanes } from "../remote-lanes/topologyLanes";
import { EVENT_LANES_RESOURCE_ID } from "../event-lanes/eventLanes.resource";
import {
  assignLaneTargetOrThrow,
  assertEventNotAssignedToOtherLane,
  collectCrossLaneApplyToEventIds,
  isRegisteredDefinitionId,
  readTargetId,
  toPublicPredicateCandidate,
  visitLaneApplyTo,
} from "../remote-lanes/laneAssignmentUtils";

type ResolvedTarget =
  | { kind: "task"; id: string }
  | { kind: "event"; id: string };

export interface RpcLaneAssignments {
  taskLaneByTaskId: Map<string, IRpcLaneDefinition>;
  eventLaneByEventId: Map<string, IRpcLaneDefinition>;
}

export function resolveRpcLaneAssignments(
  store: Store,
  lanes: readonly IRpcLaneDefinition[],
): RpcLaneAssignments {
  const taskLaneByTaskId = new Map<string, IRpcLaneDefinition>();
  const eventLaneByEventId = new Map<string, IRpcLaneDefinition>();
  const eventLaneApplyToEventIds = collectEventLaneApplyToEventIds(store);

  for (const lane of lanes) {
    const applyTo = lane.applyTo;
    if (applyTo === undefined) continue;

    visitLaneApplyTo({
      store,
      laneId: lane.id,
      applyTo,
      invalidTargetError: rpcLaneApplyToInvalidTargetError,
      predicateSources: [
        ...Array.from(store.tasks.values(), (taskEntry) => ({
          kind: "task" as const,
          entry: taskEntry,
        })),
        ...Array.from(store.events.values(), (eventEntry) => ({
          kind: "event" as const,
          entry: eventEntry,
        })),
      ],
      toPredicateCandidate: (candidate) =>
        candidate.kind === "task"
          ? toPublicPredicateCandidate(store, candidate.entry.task)
          : toPublicPredicateCandidate(store, candidate.entry.event),
      onPredicateMatch: (candidate) => {
        if (candidate.kind === "task") {
          assignTask(taskLaneByTaskId, candidate.entry.task.id, lane, store);
          return;
        }

        assertEventIsNotExplicitlyAssignedToEventLane(
          eventLaneApplyToEventIds,
          candidate.entry.event.id,
          lane.id,
        );
        assignEvent(eventLaneByEventId, candidate.entry.event.id, lane, store);
      },
      resolveTarget: resolveRpcLaneTarget,
      onResolvedTarget: (resolvedTarget) => {
        if (resolvedTarget.kind === "task") {
          assignTask(taskLaneByTaskId, resolvedTarget.id, lane, store);
          return;
        }

        assertEventIsNotExplicitlyAssignedToEventLane(
          eventLaneApplyToEventIds,
          resolvedTarget.id,
          lane.id,
        );
        assignEvent(eventLaneByEventId, resolvedTarget.id, lane, store);
      },
    });
  }

  for (const taskEntry of store.tasks.values()) {
    const laneConfig = globalTags.rpcLane.extract(taskEntry.task.tags);
    if (!laneConfig) {
      continue;
    }

    const current = taskLaneByTaskId.get(taskEntry.task.id);
    if (current) {
      // applyTo is authoritative; ignore tag-based re-assignment.
      continue;
    }

    taskLaneByTaskId.set(taskEntry.task.id, laneConfig.lane);
  }

  for (const eventEntry of store.events.values()) {
    const laneConfig = globalTags.rpcLane.extract(eventEntry.event.tags);
    if (!laneConfig) {
      continue;
    }

    const eventId = eventEntry.event.id;
    const current = eventLaneByEventId.get(eventId);
    if (current) {
      // applyTo is authoritative; ignore tag-based re-assignment.
      continue;
    }

    // If another system explicitly applies this event, tag-based routing is ignored.
    if (eventLaneApplyToEventIds.has(eventId)) {
      continue;
    }

    eventLaneByEventId.set(eventId, laneConfig.lane);
  }

  return {
    taskLaneByTaskId,
    eventLaneByEventId,
  };
}

function assertEventIsNotExplicitlyAssignedToEventLane(
  eventLaneApplyToEventIds: Set<string>,
  eventId: string,
  rpcLaneId: string,
): void {
  assertEventNotAssignedToOtherLane({
    conflictingEventIds: eventLaneApplyToEventIds,
    eventId,
    attemptedLaneId: rpcLaneId,
    laneIdField: "rpcLaneId",
    conflictError: rpcLaneAssignmentEventLaneConflictError,
  });
}

function assignTask(
  assignments: Map<string, IRpcLaneDefinition>,
  taskId: string,
  lane: IRpcLaneDefinition,
  store: Store,
): void {
  assignLaneTargetOrThrow({
    assignments,
    targetId: taskId,
    lane,
    store,
    targetField: "taskId",
    conflictError: rpcLaneTaskAssignmentConflictError,
  });
}

function assignEvent(
  assignments: Map<string, IRpcLaneDefinition>,
  eventId: string,
  lane: IRpcLaneDefinition,
  store: Store,
): void {
  assignLaneTargetOrThrow({
    assignments,
    targetId: eventId,
    lane,
    store,
    targetField: "eventId",
    conflictError: rpcLaneEventAssignmentConflictError,
  });
}

function resolveRpcLaneTarget(
  target: unknown,
  laneId: string,
  store: Store,
): ResolvedTarget {
  const targetId = readTargetId(
    target,
    laneId,
    rpcLaneApplyToInvalidTargetError,
  );
  const taskEntry = store.tasks.get(targetId);
  if (taskEntry) {
    return { kind: "task", id: taskEntry.task.id };
  }

  const eventEntry = store.events.get(targetId);
  if (eventEntry) {
    return { kind: "event", id: eventEntry.event.id };
  }

  if (isRegisteredDefinitionId(store, targetId)) {
    return rpcLaneApplyToTargetTypeError.throw({
      laneId,
      targetId,
    });
  }

  return rpcLaneApplyToTargetNotFoundError.throw({
    laneId,
    targetId,
  });
}

function collectEventLaneApplyToEventIds(store: Store): Set<string> {
  return collectCrossLaneApplyToEventIds(
    store,
    EVENT_LANES_RESOURCE_ID,
    collectEventTopologyLanes as (
      topology: unknown,
    ) => readonly { applyTo?: unknown }[],
  );
}
