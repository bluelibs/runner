import type { IEventLaneTopology, IRpcLaneDefinition } from "../../defs";
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

const EVENT_LANES_RESOURCE_ID = "globals.resources.node.eventLanes";

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

  for (const taskEntry of store.tasks.values()) {
    const laneConfig = globalTags.rpcLane.extract(taskEntry.task.tags);
    if (!laneConfig) {
      continue;
    }
    taskLaneByTaskId.set(taskEntry.task.id, laneConfig.lane);
  }

  for (const eventEntry of store.events.values()) {
    const laneConfig = globalTags.rpcLane.extract(eventEntry.event.tags);
    if (!laneConfig) {
      continue;
    }
    assertEventIsNotAssignedToEventLane(
      store,
      eventLaneApplyToEventIds,
      eventEntry.event.id,
      laneConfig.lane.id,
    );
    eventLaneByEventId.set(eventEntry.event.id, laneConfig.lane);
  }

  for (const lane of lanes) {
    for (const target of lane.applyTo ?? []) {
      const resolvedTarget = resolveRpcLaneTarget(target, lane.id, store);
      if (resolvedTarget.kind === "task") {
        assignTask(taskLaneByTaskId, resolvedTarget.id, lane);
        continue;
      }

      assertEventIsNotAssignedToEventLane(
        store,
        eventLaneApplyToEventIds,
        resolvedTarget.id,
        lane.id,
      );
      assignEvent(eventLaneByEventId, resolvedTarget.id, lane);
    }
  }

  return {
    taskLaneByTaskId,
    eventLaneByEventId,
  };
}

function assignTask(
  assignments: Map<string, IRpcLaneDefinition>,
  taskId: string,
  lane: IRpcLaneDefinition,
): void {
  const current = assignments.get(taskId);
  if (current && current.id !== lane.id) {
    rpcLaneTaskAssignmentConflictError.throw({
      taskId,
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
): void {
  const current = assignments.get(eventId);
  if (current && current.id !== lane.id) {
    rpcLaneEventAssignmentConflictError.throw({
      eventId,
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
  const targetId = readTargetId(target, laneId);
  if (store.tasks.has(targetId)) {
    return { kind: "task", id: targetId };
  }

  if (store.events.has(targetId)) {
    return { kind: "event", id: targetId };
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

  return rpcLaneApplyToInvalidTargetError.throw({
    laneId,
  });
}

function isRegisteredDefinitionId(store: Store, id: string): boolean {
  const collections = [
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

function assertEventIsNotAssignedToEventLane(
  store: Store,
  eventLaneApplyToEventIds: Set<string>,
  eventId: string,
  rpcLaneId: string,
): void {
  const eventEntry = store.events.get(eventId)!;

  if (
    globalTags.eventLane.exists(eventEntry.event.tags) ||
    eventLaneApplyToEventIds.has(eventId)
  ) {
    rpcLaneAssignmentEventLaneConflictError.throw({
      eventId,
      rpcLaneId,
    });
  }
}

function collectEventLaneApplyToEventIds(store: Store): Set<string> {
  const eventIds = new Set<string>();
  const eventLanesEntry = store.resources.get(EVENT_LANES_RESOURCE_ID);
  const topology = (
    eventLanesEntry?.config as { topology?: IEventLaneTopology }
  )?.topology;
  if (!topology) {
    return eventIds;
  }

  const lanes = collectEventTopologyLanes(topology);
  for (const lane of lanes) {
    for (const target of lane.applyTo ?? []) {
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
