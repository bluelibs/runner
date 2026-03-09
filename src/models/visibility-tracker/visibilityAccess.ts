import type { AccessViolation } from "./contracts";
import type { VisibilityTrackerState } from "./state";

export type RootAccessInfo = {
  accessible: boolean;
  exportedIds: string[];
};

export function getRootAccessInfo(
  state: VisibilityTrackerState,
  targetId: string,
  rootId: string,
): RootAccessInfo {
  const exportSet = state.exportSets.get(rootId);
  if (exportSet === undefined) {
    return { accessible: true, exportedIds: [] };
  }

  return { accessible: exportSet.has(targetId), exportedIds: [...exportSet] };
}

export function findVisibilityViolation(
  state: VisibilityTrackerState,
  targetId: string,
  consumerId: string,
): Extract<AccessViolation, { kind: "visibility" }> | null {
  const targetOwner = state.ownership.get(targetId);
  if (targetOwner === undefined) {
    return null;
  }

  const visibilityAllowed = isAccessibleFromOwnerChain(
    state,
    targetId,
    consumerId,
    targetOwner,
    undefined,
  );

  if (visibilityAllowed) {
    return null;
  }

  return {
    kind: "visibility",
    targetOwnerResourceId: targetOwner,
    exportedIds: [...findGatingExportSet(state, targetId, targetOwner)],
  };
}

function isAccessibleFromOwnerChain(
  state: VisibilityTrackerState,
  targetId: string,
  consumerId: string,
  ownerId: string,
  boundaryOwnerId: string | undefined,
  seenPaths: Set<string> = new Set<string>(),
): boolean {
  if (consumerId === ownerId) {
    return true;
  }

  const ownerSubtree = state.subtrees.get(ownerId);
  if (ownerSubtree?.has(consumerId)) {
    return true;
  }

  const exportSet = state.exportSets.get(ownerId);
  if (
    exportSet &&
    !isTargetAllowedByExports(state, targetId, ownerId, seenPaths)
  ) {
    return false;
  }

  if (ownerId === boundaryOwnerId) {
    return true;
  }

  const parentOwner = state.ownership.get(ownerId);
  if (parentOwner === undefined) {
    return boundaryOwnerId === undefined;
  }

  return isAccessibleFromOwnerChain(
    state,
    targetId,
    consumerId,
    parentOwner,
    boundaryOwnerId,
    seenPaths,
  );
}

function isTargetAllowedByExports(
  state: VisibilityTrackerState,
  targetId: string,
  ownerId: string,
  seenPaths: Set<string> = new Set<string>(),
): boolean {
  const exportSet = state.exportSets.get(ownerId)!;
  if (exportSet.has(targetId)) {
    return true;
  }

  for (const exportedId of exportSet) {
    const traversalKey = `${ownerId}::${exportedId}::${targetId}`;
    if (seenPaths.has(traversalKey)) {
      continue;
    }
    seenPaths.add(traversalKey);

    if (
      isVisibleOutsideExportedResource(
        state,
        targetId,
        exportedId,
        ownerId,
        seenPaths,
      )
    ) {
      return true;
    }
  }

  return false;
}

function isVisibleOutsideExportedResource(
  state: VisibilityTrackerState,
  targetId: string,
  exportedResourceId: string,
  ownerId: string,
  seenPaths: Set<string>,
): boolean {
  const exportedSubtree = state.subtrees.get(exportedResourceId);
  if (!exportedSubtree?.has(targetId)) {
    return false;
  }

  const targetOwner = state.ownership.get(targetId)!;
  return isAccessibleFromOwnerChain(
    state,
    targetId,
    ownerId,
    targetOwner,
    exportedResourceId,
    seenPaths,
  );
}

function findGatingExportSet(
  state: VisibilityTrackerState,
  targetId: string,
  ownerId: string,
): Set<string> {
  const exportSet = state.exportSets.get(ownerId);
  if (exportSet && !isTargetAllowedByExports(state, targetId, ownerId)) {
    return exportSet;
  }

  const parentOwner = state.ownership.get(ownerId);
  if (parentOwner === undefined) {
    return new Set<string>();
  }

  return findGatingExportSet(state, targetId, parentOwner);
}
