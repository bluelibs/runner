import type { Store } from "../../models/Store";
import {
  resolveRequestedIdFromStore,
  toCanonicalDefinitionFromStore,
} from "../../models/StoreLookup";

type LaneWithId = {
  id: string;
};

type EventLaneConflictField = "rpcLaneId" | "eventLaneId";

function resolveCanonicalId(store: Store, id: string): string {
  return resolveRequestedIdFromStore(store, id) ?? id;
}

/**
 * Extracts the id string from a lane applyTo target.
 * Accepts a plain string or an object with an `id` property.
 * Returns undefined if the target doesn't match either shape.
 */
export function extractTargetId(target: unknown): string | undefined {
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

/**
 * Reads a target id from a lane applyTo entry, requiring a non-empty string result.
 * Throws the given error when the target doesn't resolve to a non-empty string id.
 */
export function readTargetId(
  target: unknown,
  laneId: string,
  invalidTargetError: { throw: (data: { laneId: string }) => never },
): string {
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

  return invalidTargetError.throw({ laneId });
}

/**
 * Checks whether a given id is registered as any definition type in the store
 * (tasks, resources, hooks, middlewares, errors, tags, async contexts).
 */
export function isRegisteredDefinitionId(store: Store, id: string): boolean {
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

/**
 * Collects event ids that are explicitly targeted by applyTo in a
 * cross-lane topology (e.g. scanning RPC topology from an event-lane context
 * or vice versa). Parameterized by resource id and lane-collection function
 * so both EventLaneAssignments and RpcLaneAssignments can share the logic.
 */
export function collectCrossLaneApplyToEventIds(
  store: Store,
  resourceId: string,
  collectTopologyLanes: (topology: unknown) => readonly { applyTo?: unknown }[],
): Set<string> {
  const eventIds = new Set<string>();
  const entry = store.resources.get(resolveCanonicalId(store, resourceId));
  const config = entry?.config as Record<string, unknown> | undefined;
  const topology = config?.topology;
  if (!topology) {
    return eventIds;
  }

  const lanes = collectTopologyLanes(topology);
  for (const lane of lanes) {
    const applyTo = lane.applyTo;
    if (applyTo === undefined) continue;

    if (typeof applyTo === "function") {
      for (const eventEntry of store.events.values()) {
        if (applyTo(toPublicPredicateCandidate(store, eventEntry.event))) {
          eventIds.add(eventEntry.event.id);
        }
      }
      continue;
    }

    if (!Array.isArray(applyTo)) continue;
    for (const target of applyTo) {
      const targetId = extractTargetId(target);
      if (typeof targetId !== "string") {
        continue;
      }

      const eventEntry = store.events.get(resolveCanonicalId(store, targetId));
      if (eventEntry) {
        eventIds.add(eventEntry.event.id);
      }
    }
  }

  return eventIds;
}

export function toPublicPredicateCandidate<T extends { id: string }>(
  store: Store,
  definition: T,
): T {
  return toCanonicalDefinitionFromStore(store, definition);
}

export function visitLaneApplyTo<TSource, TResolvedTarget>(options: {
  store: Store;
  laneId: string;
  applyTo: unknown;
  invalidTargetError: { throw: (data: { laneId: string }) => never };
  predicateSources: Iterable<TSource>;
  toPredicateCandidate: (source: TSource) => unknown;
  onPredicateMatch: (source: TSource) => void;
  resolveTarget: (
    target: unknown,
    laneId: string,
    store: Store,
  ) => TResolvedTarget;
  onResolvedTarget: (target: TResolvedTarget) => void;
}): void {
  const {
    store,
    laneId,
    applyTo,
    invalidTargetError,
    predicateSources,
    toPredicateCandidate,
    onPredicateMatch,
    resolveTarget,
    onResolvedTarget,
  } = options;

  if (typeof applyTo === "function") {
    for (const source of predicateSources) {
      if (applyTo(toPredicateCandidate(source))) {
        onPredicateMatch(source);
      }
    }
    return;
  }

  if (!Array.isArray(applyTo)) {
    invalidTargetError.throw({ laneId });
  }

  for (const target of applyTo as readonly unknown[]) {
    onResolvedTarget(resolveTarget(target, laneId, store));
  }
}

export function assertEventNotAssignedToOtherLane<
  TField extends EventLaneConflictField,
>(options: {
  conflictingEventIds: ReadonlySet<string>;
  eventId: string;
  attemptedLaneId: string;
  laneIdField: TField;
  conflictError: {
    throw: (data: { eventId: string } & Record<TField, string>) => never;
  };
}): void {
  const {
    conflictingEventIds,
    eventId,
    attemptedLaneId,
    laneIdField,
    conflictError,
  } = options;

  if (!conflictingEventIds.has(eventId)) {
    return;
  }

  conflictError.throw({
    eventId,
    [laneIdField]: attemptedLaneId,
  } as { eventId: string } & Record<TField, string>);
}

export function assignLaneTargetOrThrow<TLane extends LaneWithId>(options: {
  assignments: Map<string, TLane>;
  targetId: string;
  lane: TLane;
  store: Store;
  targetField: "taskId" | "eventId";
  conflictError: {
    throw: (
      data: Record<"currentLaneId" | "attemptedLaneId", string> &
        Record<"taskId" | "eventId", string>,
    ) => never;
  };
}): void {
  const { assignments, targetId, lane, store, targetField, conflictError } =
    options;
  const current = assignments.get(targetId);

  if (current && current.id !== lane.id) {
    conflictError.throw({
      [targetField]: resolveCanonicalId(store, targetId),
      currentLaneId: current.id,
      attemptedLaneId: lane.id,
    } as Record<"currentLaneId" | "attemptedLaneId", string> &
      Record<"taskId" | "eventId", string>);
  }

  if (!current) {
    assignments.set(targetId, lane);
  }
}
