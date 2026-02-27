import type { IEventLaneDefinition, IRpcLanesTopology } from "../../defs";
import { createMessageError } from "../../errors";
import { globalTags } from "../../globals/globalTags";
import type { Store } from "../../models/Store";
import { collectRpcTopologyLanes } from "../remote-lanes/topologyLanes";

const RPC_LANES_RESOURCE_ID = "platform.node.resources.rpcLanes";

export interface EventLaneRoute {
  lane: IEventLaneDefinition;
  orderingKey?: string;
  metadata?: Record<string, unknown>;
}

export function resolveEventLaneAssignments(
  store: Store,
  lanes: readonly IEventLaneDefinition[],
): Map<string, EventLaneRoute> {
  const routesByEventId = new Map<string, EventLaneRoute>();
  const rpcLaneApplyToEventIds = collectRpcLaneApplyToEventIds(store);

  for (const eventEntry of store.events.values()) {
    const laneConfig = globalTags.eventLane.extract(eventEntry.event.tags);
    if (!laneConfig) {
      continue;
    }

    assertEventIsNotAssignedToRpcLane(
      store,
      rpcLaneApplyToEventIds,
      eventEntry.event.id,
      laneConfig.lane.id,
    );

    routesByEventId.set(eventEntry.event.id, {
      lane: laneConfig.lane,
      orderingKey: laneConfig.orderingKey,
      metadata: laneConfig.metadata,
    });
  }

  for (const lane of lanes) {
    for (const target of lane.applyTo ?? []) {
      const eventId = resolveEventLaneTarget(target, lane.id, store);
      assertEventIsNotAssignedToRpcLane(
        store,
        rpcLaneApplyToEventIds,
        eventId,
        lane.id,
      );

      const current = routesByEventId.get(eventId);
      if (current && current.lane.id !== lane.id) {
        createMessageError(
          `Event "${eventId}" is already assigned to eventLane "${current.lane.id}". Cannot also assign eventLane "${lane.id}" via applyTo().`,
        );
      }

      if (!current) {
        routesByEventId.set(eventId, { lane });
      }
    }
  }

  return routesByEventId;
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
    return createMessageError(
      `eventLane "${laneId}" applyTo target "${targetId}" must reference an event, but resolved to a non-event definition.`,
    );
  }

  return createMessageError(
    `eventLane "${laneId}" applyTo target "${targetId}" was not found in this container. Register it first or fix the id.`,
  );
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

  return createMessageError(
    `eventLane "${laneId}" applyTo() received an invalid target. Expected an event or non-empty id string.`,
  );
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

function assertEventIsNotAssignedToRpcLane(
  store: Store,
  rpcLaneApplyToEventIds: Set<string>,
  eventId: string,
  eventLaneId: string,
): void {
  const eventEntry = store.events.get(eventId)!;

  if (
    globalTags.rpcLane.exists(eventEntry.event.tags) ||
    rpcLaneApplyToEventIds.has(eventId)
  ) {
    createMessageError(
      `Event "${eventId}" cannot be assigned to eventLane "${eventLaneId}" because it is already assigned to an rpcLane.`,
    );
  }
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
