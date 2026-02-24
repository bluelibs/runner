import {
  DisposeWave,
  InitWave,
  ResourceStoreElementType,
} from "../../types/storeTypes";
import { getResourceDependencyIds } from "./resourceDependencyIds";

/**
 * Returns initialized resources grouped into disposal waves (dependents first).
 * Uses the recorded init waves when complete; otherwise falls back to a
 * topological order converted to sequential single-resource waves.
 */
export function getResourcesInDisposeWaves(
  resources: Map<string, ResourceStoreElementType>,
  initWaves: readonly InitWave[],
): DisposeWave[] {
  const initializedResources = Array.from(resources.values()).filter(
    (r) => r.isInitialized,
  );

  // Fast path: reverse fully-tracked initialization waves for disposal.
  // This preserves the original dependency-ready parallel grouping.
  const initWaveIds = initWaves.flatMap((wave) => wave.resourceIds);
  const initializedIdSet = new Set(
    initializedResources.map((resource) => resource.resource.id),
  );
  const initWavesCoverAllInitialized =
    initWaveIds.length === initializedResources.length &&
    initWaveIds.every((id) => initializedIdSet.has(id));

  if (initWavesCoverAllInitialized) {
    const byId = new Map(
      initializedResources.map((r) => [r.resource.id, r] as const),
    );
    return initWaves
      .slice()
      .reverse()
      .map((wave) => {
        const waveResources = wave.resourceIds
          .map((id) => byId.get(id))
          .filter((resource): resource is ResourceStoreElementType =>
            Boolean(resource),
          );

        return {
          resources: waveResources,
          parallel: wave.parallel && waveResources.length > 1,
        };
      })
      .filter((wave) => wave.resources.length > 0);
  }

  // Fallback: derive a deterministic dependents-first order from the graph and
  // model it as sequential waves.
  const visitState = new Map<string, "visiting" | "visited">();
  const initOrder: ResourceStoreElementType[] = [];
  let cycleDetected = false;

  const getDependencyIds = (resource: ResourceStoreElementType): string[] => {
    return getResourceDependencyIds(resource.resource.dependencies);
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
    return initializedResources
      .slice()
      .reverse()
      .map((resource) => ({
        resources: [resource],
        parallel: false,
      }));
  }

  return initOrder.reverse().map((resource) => ({
    resources: [resource],
    parallel: false,
  }));
}
