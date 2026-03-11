import type { EventLanesResourceContext } from "./EventLanesInternals";
import { getLaneBindingOrThrow } from "./EventLanesInternals";

export function validateAssignedEventRoutesHaveBindings(
  context: EventLanesResourceContext,
): void {
  const seenLaneIds = new Set<string>();
  for (const route of context.eventRouteByEventId.values()) {
    if (seenLaneIds.has(route.lane.id)) {
      continue;
    }
    seenLaneIds.add(route.lane.id);
    getLaneBindingOrThrow(route.lane.id, context.bindingsByLaneId);
  }
}

export async function applyPrefetchPolicies(
  context: EventLanesResourceContext,
): Promise<void> {
  for (const [queue, laneIds] of context.activeBindingsByQueue) {
    let resolvedPrefetch: number | undefined;
    for (const laneId of laneIds) {
      const binding = context.bindingsByLaneId.get(laneId)!;
      const candidatePrefetch = binding.prefetch;
      if (candidatePrefetch === undefined || candidatePrefetch < 1) {
        continue;
      }
      resolvedPrefetch = Math.max(resolvedPrefetch ?? 0, candidatePrefetch);
    }

    if (resolvedPrefetch !== undefined) {
      await queue.setPrefetch?.(resolvedPrefetch);
    }
  }
}
