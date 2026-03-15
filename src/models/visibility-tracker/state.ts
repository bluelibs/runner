import type {
  IResourceWithConfig,
  IsolationPolicy,
  ItemType,
  RegisterableItem,
} from "../../defs";
import * as utils from "../../define";
import type { CompiledIsolationPolicy } from "./contracts";
import { compileIsolationPolicy } from "./policyCompiler";

export type VisibilityTrackerState = {
  ownership: Map<string, string>;
  exportSets: Map<string, Set<string>>;
  subtrees: Map<string, Set<string>>;
  knownResources: Set<string>;
  isolationPolicies: Map<string, CompiledIsolationPolicy>;
  definitionTagIds: Map<string, Set<string>>;
  itemTypes: Map<string, ItemType>;
};

export function createVisibilityTrackerState(): VisibilityTrackerState {
  return {
    ownership: new Map<string, string>(),
    exportSets: new Map<string, Set<string>>(),
    subtrees: new Map<string, Set<string>>(),
    knownResources: new Set<string>(),
    isolationPolicies: new Map<string, CompiledIsolationPolicy>(),
    definitionTagIds: new Map<string, Set<string>>(),
    itemTypes: new Map<string, ItemType>(),
  };
}

function deriveItemType(item: RegisterableItem): ItemType | undefined {
  if (utils.isTask(item)) return "task";
  if (utils.isResource(item) || utils.isResourceWithConfig(item)) {
    return "resource";
  }
  if (utils.isEvent(item) || utils.isEventLane(item) || utils.isRpcLane(item)) {
    return "event";
  }
  if (utils.isTag(item)) return "tag";
  if (utils.isHook(item)) return "hook";
  if (utils.isTaskMiddleware(item)) return "taskMiddleware";
  if (utils.isResourceMiddleware(item)) return "resourceMiddleware";
  return undefined;
}

function getItemId(item: RegisterableItem): string | undefined {
  if (!item || (typeof item !== "object" && typeof item !== "function")) {
    return undefined;
  }
  if (utils.isResourceWithConfig(item)) {
    return (item as IResourceWithConfig).resource.id;
  }
  if ("id" in item) {
    return (item as { id: string }).id;
  }
  return undefined;
}

export function recordResource(
  state: VisibilityTrackerState,
  resourceId: string,
): void {
  state.knownResources.add(resourceId);
}

export function recordDefinitionTags(
  state: VisibilityTrackerState,
  definitionId: string,
  tags: ReadonlyArray<{ id: string }>,
): void {
  if (!tags || tags.length === 0) {
    state.definitionTagIds.delete(definitionId);
    return;
  }

  state.definitionTagIds.set(definitionId, new Set(tags.map((tag) => tag.id)));
}

export function recordIsolation(
  state: VisibilityTrackerState,
  resourceId: string,
  policy?: IsolationPolicy,
): void {
  state.knownResources.add(resourceId);

  const compiledPolicy = compileIsolationPolicy(policy);
  if (!compiledPolicy) {
    state.isolationPolicies.delete(resourceId);
    return;
  }

  state.isolationPolicies.set(resourceId, compiledPolicy);
}

export function recordOwnership(
  state: VisibilityTrackerState,
  ownerResourceId: string,
  item: RegisterableItem,
): void {
  const id = getItemId(item);
  if (!id) {
    return;
  }

  if (state.ownership.has(id)) {
    return;
  }

  state.ownership.set(id, ownerResourceId);

  const type = deriveItemType(item);
  if (type) {
    state.itemTypes.set(id, type);
  }

  const visitedOwners = new Set<string>();
  let current: string | undefined = ownerResourceId;
  while (current !== undefined && !visitedOwners.has(current)) {
    visitedOwners.add(current);
    let subtree = state.subtrees.get(current);
    if (!subtree) {
      subtree = new Set();
      state.subtrees.set(current, subtree);
    }
    subtree.add(id);
    current = state.ownership.get(current);
  }
}

export function recordExports(
  state: VisibilityTrackerState,
  resourceId: string,
  exports: Array<RegisterableItem | string>,
): void {
  const ids = new Set<string>();

  for (const item of exports) {
    if (typeof item === "string") {
      ids.add(item);
      continue;
    }

    const id = getItemId(item);
    if (id) {
      ids.add(id);
    }
  }

  state.exportSets.set(resourceId, ids);
}

export function getOwnerResourceId(
  state: VisibilityTrackerState,
  itemId: string,
): string | undefined {
  return state.ownership.get(itemId);
}

export function isWithinResourceSubtree(
  state: VisibilityTrackerState,
  resourceId: string,
  itemId: string,
): boolean {
  if (resourceId === itemId) {
    return true;
  }

  return state.subtrees.get(resourceId)?.has(itemId) === true;
}

export function rollbackOwnershipTree(
  state: VisibilityTrackerState,
  itemId: string,
): void {
  const toRemove = new Set<string>();
  if (state.ownership.has(itemId)) {
    toRemove.add(itemId);
  }

  let added = true;
  while (added) {
    added = false;
    for (const [id, ownerId] of state.ownership.entries()) {
      if (!toRemove.has(id) && toRemove.has(ownerId)) {
        toRemove.add(id);
        added = true;
      }
    }
  }

  if (toRemove.size === 0) {
    return;
  }

  for (const id of toRemove) {
    state.ownership.delete(id);
    state.exportSets.delete(id);
    state.subtrees.delete(id);
    state.knownResources.delete(id);
    state.isolationPolicies.delete(id);
    state.definitionTagIds.delete(id);
    state.itemTypes.delete(id);
  }

  for (const subtree of state.subtrees.values()) {
    for (const id of toRemove) {
      subtree.delete(id);
    }
  }
}
