import type { Store } from "../../models/Store";
import { toPublicDefinition } from "../../models/utils/toPublicDefinition";

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
  const entry = store.resources.get(resourceId);
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

      const eventEntry = store.events.get(targetId);
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
  return toPublicDefinition(store, definition);
}
