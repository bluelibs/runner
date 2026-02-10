import { ResourceStoreElementType } from "../../types/storeTypes";
import { isOptional, isResource } from "../../define";

/**
 * Returns initialized resources sorted in dispose order (dependents first).
 * Uses the recorded init-order when complete, otherwise falls back to a
 * topological sort derived from the resource dependency graph.
 */
export function getResourcesInDisposeOrder(
  resources: Map<string, ResourceStoreElementType>,
  initializedResourceIds: readonly string[],
): ResourceStoreElementType[] {
  const initializedResources = Array.from(resources.values()).filter(
    (r) => r.isInitialized,
  );

  // Fast path: if the store tracked a complete init order, reverse it for disposal.
  // This is correct because initialization happens dependency-first, so dependents
  // always appear after their dependencies in the init sequence.
  const initOrderHasAllInitialized =
    initializedResourceIds.length === initializedResources.length &&
    initializedResources.every((r) =>
      initializedResourceIds.includes(r.resource.id),
    );
  if (initOrderHasAllInitialized) {
    const byId = new Map(
      initializedResources.map((r) => [r.resource.id, r] as const),
    );
    return initializedResourceIds
      .slice()
      .reverse()
      .map((id) => byId.get(id))
      .filter((r): r is ResourceStoreElementType => Boolean(r));
  }

  // Dispose order should be dependents-first (reverse init order).
  // We derive it from the resource dependency graph to make it stable
  // regardless of registration/insertion order.
  const visitState = new Map<string, "visiting" | "visited">();
  const initOrder: ResourceStoreElementType[] = [];
  let cycleDetected = false;

  const getDependencyIds = (resource: ResourceStoreElementType): string[] => {
    const raw = resource.resource.dependencies;
    if (!raw) return [];
    const deps = raw as unknown;
    if (!deps || typeof deps !== "object") return [];

    const out: string[] = [];
    const collect = (value: unknown): void => {
      if (isOptional(value)) {
        collect((value as { inner: unknown }).inner);
        return;
      }
      if (isResource(value)) {
        out.push(value.id);
      }
    };

    Object.values(deps as Record<string, unknown>).forEach(collect);
    return out;
  };

  const visit = (resourceId: string): void => {
    const state = visitState.get(resourceId);
    if (state === "visited") return;
    if (state === "visiting") {
      cycleDetected = true;
      return;
    }

    const resource = resources.get(resourceId);
    if (!resource) return;

    visitState.set(resourceId, "visiting");
    getDependencyIds(resource).forEach(visit);
    visitState.set(resourceId, "visited");
    initOrder.push(resource);
  };

  initializedResources.forEach((r) => visit(r.resource.id));

  // If a cycle sneaks in despite validation (or disposal is called on a
  // partially-initialized store), fall back to insertion order LIFO.
  if (cycleDetected) {
    return initializedResources.slice().reverse();
  }

  return initOrder.reverse();
}
