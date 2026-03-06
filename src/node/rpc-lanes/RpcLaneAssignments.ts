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
  readTargetId,
  isRegisteredDefinitionId,
  collectCrossLaneApplyToEventIds,
  toPublicPredicateCandidate,
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

    if (typeof applyTo === "function") {
      for (const taskEntry of store.tasks.values()) {
        if (applyTo(toPublicPredicateCandidate(store, taskEntry.task))) {
          assignTask(taskLaneByTaskId, taskEntry.task.id, lane, store);
        }
      }

      for (const eventEntry of store.events.values()) {
        if (!applyTo(toPublicPredicateCandidate(store, eventEntry.event))) {
          continue;
        }
        assertEventIsNotExplicitlyAssignedToEventLane(
          eventLaneApplyToEventIds,
          eventEntry.event.id,
          lane.id,
          store,
        );
        assignEvent(eventLaneByEventId, eventEntry.event.id, lane, store);
      }
      continue;
    }

    if (!Array.isArray(applyTo)) {
      rpcLaneApplyToInvalidTargetError.throw({ laneId: lane.id });
    }

    for (const target of applyTo) {
      const resolvedTarget = resolveRpcLaneTarget(target, lane.id, store);
      if (resolvedTarget.kind === "task") {
        assignTask(taskLaneByTaskId, resolvedTarget.id, lane, store);
        continue;
      }

      assertEventIsNotExplicitlyAssignedToEventLane(
        eventLaneApplyToEventIds,
        resolvedTarget.id,
        lane.id,
        store,
      );
      assignEvent(eventLaneByEventId, resolvedTarget.id, lane, store);
    }
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

    // Without explicit applyTo, IoC tags must not assign the same event to both systems.
    if (globalTags.eventLane.exists(eventEntry.event.tags)) {
      rpcLaneAssignmentEventLaneConflictError.throw({
        eventId: store.toPublicId(eventId),
        rpcLaneId: laneConfig.lane.id,
      });
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
  store: Store,
): void {
  if (eventLaneApplyToEventIds.has(eventId)) {
    rpcLaneAssignmentEventLaneConflictError.throw({
      eventId: store.toPublicId(eventId),
      rpcLaneId,
    });
  }
}

function assignTask(
  assignments: Map<string, IRpcLaneDefinition>,
  taskId: string,
  lane: IRpcLaneDefinition,
  store: Store,
): void {
  const current = assignments.get(taskId);
  if (current && current.id !== lane.id) {
    rpcLaneTaskAssignmentConflictError.throw({
      taskId: store.toPublicId(taskId),
      currentLaneId: current.id,
      attemptedLaneId: lane.id,
    });
  }

  if (!current) {
    assignments.set(taskId, lane);
  }
}

function assignEvent(
  assignments: Map<string, IRpcLaneDefinition>,
  eventId: string,
  lane: IRpcLaneDefinition,
  store: Store,
): void {
  const current = assignments.get(eventId);
  if (current && current.id !== lane.id) {
    rpcLaneEventAssignmentConflictError.throw({
      eventId: store.toPublicId(eventId),
      currentLaneId: current.id,
      attemptedLaneId: lane.id,
    });
  }

  if (!current) {
    assignments.set(eventId, lane);
  }
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
      targetId: store.toPublicId(targetId),
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
