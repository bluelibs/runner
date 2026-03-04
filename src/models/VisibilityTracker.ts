import {
  RegisterableItems,
  IResourceWithConfig,
  IsolationPolicy,
  IsolationSubtreeFilter,
  ItemType,
} from "../defs";
import * as utils from "../define";
import { isolateViolationError, visibilityViolationError } from "../errors";
import { StoreRegistry } from "./StoreRegistry";
import {
  getSubtreeResourceMiddlewareAttachment,
  getSubtreeTaskMiddlewareAttachment,
} from "../tools/subtreeMiddleware";

type CompiledIsolationPolicy = {
  denyIds: Set<string>;
  denyTagIds: Set<string>;
  // Structural subtree filters for deny rules — resolved lazily from this.subtrees
  // at violation-check time so overridable ids and late-registered children are included.
  denySubtreeFilters: IsolationSubtreeFilter[];
  // onlyMode=true means the policy uses "only" semantics (allowlist).
  // When true, external deps not in onlyIds/onlyTagIds/onlySubtreeFilters are blocked.
  onlyMode: boolean;
  onlyIds: Set<string>;
  onlyTagIds: Set<string>;
  onlySubtreeFilters: IsolationSubtreeFilter[];
};

type AccessViolation =
  | {
      kind: "visibility";
      targetOwnerResourceId: string;
      exportedIds: string[];
    }
  | {
      kind: "isolate";
      policyResourceId: string;
      matchedRuleType: "id" | "tag" | "only" | "subtree";
      matchedRuleId: string;
    };

/**
 * Maps a registerable item to its Runner ItemType string.
 * Needed so subtreeOf({ types: ["task"] }) can filter by item kind at violation-check time.
 */
function deriveItemType(item: RegisterableItems): ItemType | undefined {
  if (utils.isTask(item)) return "task";
  if (utils.isResource(item) || utils.isResourceWithConfig(item))
    return "resource";
  if (utils.isEvent(item) || utils.isEventLane(item) || utils.isRpcLane(item))
    return "event";
  if (utils.isTag(item)) return "tag";
  if (utils.isHook(item)) return "hook";
  if (utils.isTaskMiddleware(item)) return "taskMiddleware";
  if (utils.isResourceMiddleware(item)) return "resourceMiddleware";
  return undefined;
}

/**
 * Extracts the string id from any registerable item.
 */
function getItemId(item: RegisterableItems): string | undefined {
  if (utils.isResourceWithConfig(item)) {
    return (item as IResourceWithConfig).resource.id;
  }
  if (item && typeof item === "object" && "id" in item) {
    return (item as { id: string }).id;
  }
  return undefined;
}

/**
 * Determines the human-readable type label for a registerable item.
 */
function getItemTypeLabel(registry: StoreRegistry, id: string): string {
  void registry;
  void id;
  return "Item";
}

function resolveReferenceId(
  registry: StoreRegistry,
  reference: unknown,
): string | undefined {
  const resolved = registry.resolveDefinitionId(reference);
  if (!resolved || resolved.length === 0) {
    return undefined;
  }
  return resolved;
}

/**
 * Tracks which resource owns (registered) each item and which items
 * are exported by resources that declare an exports list.
 *
 * Ownership is established during registration: when resource R calls
 * `.register([item])`, item is "owned" by R.
 *
 * When R declares isolate exports, only those items are visible
 * to items outside R's registration subtree.
 */
export class VisibilityTracker {
  /**
   * Maps item id → id of the resource that directly registered it.
   * Items registered by the root resource have the root's id as owner.
   */
  private readonly ownership = new Map<string, string>();

  /**
   * For each resource that declares exports: resource id → Set of
   * exported item ids. Resources without isolate exports are absent
   * from this map (meaning "everything is public").
   */
  private readonly exportSets = new Map<string, Set<string>>();

  /**
   * Maps resource id → set of all item ids in its registration subtree
   * (including items registered by nested child resources).
   */
  private readonly subtrees = new Map<string, Set<string>>();

  /**
   * Registered resource ids. Used to detect consumer resource boundaries
   * (including root resources with no owner).
   */
  private readonly knownResources = new Set<string>();

  /**
   * Resource id -> compiled additive isolation policy.
   */
  private readonly isolationPolicies = new Map<
    string,
    CompiledIsolationPolicy
  >();

  /**
   * Definition id -> tag ids carried by that definition.
   */
  private readonly definitionTagIds = new Map<string, Set<string>>();

  /**
   * Definition id -> its Runner item type (task, event, resource, etc.).
   * Used to evaluate `subtreeOf()` type filters without needing the registry.
   */
  private readonly itemTypes = new Map<string, ItemType>();

  recordResource(resourceId: string): void {
    this.knownResources.add(resourceId);
  }

  recordDefinitionTags(
    definitionId: string,
    tags: ReadonlyArray<{ id: string }>,
  ): void {
    if (!tags || tags.length === 0) {
      this.definitionTagIds.delete(definitionId);
      return;
    }

    this.definitionTagIds.set(definitionId, new Set(tags.map((tag) => tag.id)));
  }

  recordIsolation(resourceId: string, policy?: IsolationPolicy): void {
    this.knownResources.add(resourceId);

    const hasDeny = Array.isArray(policy?.deny) && policy!.deny!.length > 0;
    // "only mode" is active whenever the only field is an array, even if empty.
    const onlyPresent = policy !== undefined && Array.isArray(policy.only);

    if (!hasDeny && !onlyPresent) {
      this.isolationPolicies.delete(resourceId);
      return;
    }

    const denyIds = new Set<string>();
    const denyTagIds = new Set<string>();
    const denySubtreeFilters: IsolationSubtreeFilter[] = [];
    const onlyIds = new Set<string>();
    const onlyTagIds = new Set<string>();
    const onlySubtreeFilters: IsolationSubtreeFilter[] = [];

    const resolveEntry = (
      entry: unknown,
      ids: Set<string>,
      tagIds: Set<string>,
      subtreeFilters: IsolationSubtreeFilter[],
    ) => {
      // Structural subtree references are stored separately — they are resolved
      // lazily against this.subtrees at violation-check time.
      if (utils.isSubtreeFilter(entry)) {
        subtreeFilters.push(entry);
        return;
      }
      if (typeof entry === "string") {
        ids.add(entry);
        return;
      }
      const maybeId = getItemId(entry as RegisterableItems);
      if (!maybeId) return;
      if (utils.isTag(entry)) {
        tagIds.add(maybeId);
      } else {
        ids.add(maybeId);
      }
    };

    if (hasDeny) {
      for (const entry of policy!.deny!) {
        resolveEntry(entry, denyIds, denyTagIds, denySubtreeFilters);
      }
    }

    if (onlyPresent) {
      for (const entry of policy!.only!) {
        resolveEntry(entry, onlyIds, onlyTagIds, onlySubtreeFilters);
      }
    }

    this.isolationPolicies.set(resourceId, {
      denyIds,
      denyTagIds,
      denySubtreeFilters,
      onlyMode: onlyPresent,
      onlyIds,
      onlyTagIds,
      onlySubtreeFilters,
    });
  }

  /**
   * Records ownership when a resource registers an item.
   */
  recordOwnership(ownerResourceId: string, item: RegisterableItems): void {
    const id = getItemId(item);
    if (!id) return;

    // Keep first ownership immutable. If the same id is registered again,
    // StoreValidator will fail the duplicate registration; overwriting here
    // can create ownership cycles before that error is thrown.
    if (this.ownership.has(id)) {
      return;
    }

    this.ownership.set(id, ownerResourceId);

    const type = deriveItemType(item);
    if (type) this.itemTypes.set(id, type);

    // Add to owner's subtree and all ancestor subtrees
    const visitedOwners = new Set<string>();
    let current: string | undefined = ownerResourceId;
    while (current !== undefined && !visitedOwners.has(current)) {
      visitedOwners.add(current);
      let subtree = this.subtrees.get(current);
      if (!subtree) {
        subtree = new Set();
        this.subtrees.set(current, subtree);
      }
      subtree.add(id);
      // Walk up to the resource's own owner (parent)
      current = this.ownership.get(current);
    }
  }

  /**
   * Records the export set for a resource that declares isolate exports.
   */
  recordExports(
    resourceId: string,
    exports: Array<RegisterableItems | string>,
  ): void {
    const ids = new Set<string>();
    for (const item of exports) {
      if (typeof item === "string") {
        ids.add(item);
        continue;
      }

      const id = getItemId(item);
      if (id) ids.add(id);
    }
    this.exportSets.set(resourceId, ids);
  }

  /**
   * Checks whether a target id is visible through the root resource's export
   * surface for runtime API calls (runTask, emitEvent, getResourceValue, etc.).
   *
   * When the root has no isolate exports declaration the surface is fully open
   * (backward compatible). Otherwise only explicitly listed ids are reachable.
   *
   * Returns both the accessibility result and the current exported id list so
   * callers can produce a useful remediation message without a second lookup.
   */
  getRootAccessInfo(
    targetId: string,
    rootId: string,
  ): { accessible: boolean; exportedIds: string[] } {
    const exportSet = this.exportSets.get(rootId);
    // No export declaration on root → fully open (backward compat)
    if (exportSet === undefined) return { accessible: true, exportedIds: [] };
    return { accessible: exportSet.has(targetId), exportedIds: [...exportSet] };
  }

  /**
   * Checks whether `consumerId` can access `targetId`.
   *
   * An item is accessible if:
   * 1. The target's owner has no exports list (everything is public), OR
   * 2. The consumer is inside the same registration subtree as the target, OR
   * 3. The target is in the owner resource's export set (transitively up).
   */
  isAccessible(targetId: string, consumerId: string): boolean {
    return this.getAccessViolation(targetId, consumerId) === null;
  }

  getAccessViolation(
    targetId: string,
    consumerId: string,
  ): AccessViolation | null {
    const targetOwner = this.ownership.get(targetId);

    if (targetOwner !== undefined) {
      const visibilityAllowed = this.isAccessibleFromOwnerChain(
        targetId,
        consumerId,
        targetOwner,
        undefined,
        new Set<string>(),
      );

      if (!visibilityAllowed) {
        return {
          kind: "visibility",
          targetOwnerResourceId: targetOwner,
          exportedIds: [...this.findGatingExportSet(targetId, targetOwner)],
        };
      }
    }

    return this.findIsolationViolation(targetId, consumerId);
  }

  private isAccessibleFromOwnerChain(
    targetId: string,
    consumerId: string,
    ownerId: string,
    boundaryOwnerId: string | undefined,
    seenPaths: Set<string>,
  ): boolean {
    // A resource can always access items in its own registration scope.
    if (consumerId === ownerId) return true;

    // If the consumer is inside the owner's subtree, it has full access
    const ownerSubtree = this.subtrees.get(ownerId);
    if (ownerSubtree?.has(consumerId)) return true;

    const exportSet = this.exportSets.get(ownerId);
    if (
      exportSet &&
      !this.isTargetAllowedByExports(targetId, ownerId, seenPaths)
    ) {
      return false;
    }

    if (ownerId === boundaryOwnerId) {
      return true;
    }

    const parentOwner = this.ownership.get(ownerId);
    if (parentOwner === undefined) {
      return boundaryOwnerId === undefined;
    }

    return this.isAccessibleFromOwnerChain(
      targetId,
      consumerId,
      parentOwner,
      boundaryOwnerId,
      seenPaths,
    );
  }

  private isTargetAllowedByExports(
    targetId: string,
    ownerId: string,
    seenPaths: Set<string>,
  ): boolean {
    const exportSet = this.exportSets.get(ownerId)!;
    if (exportSet.has(targetId)) return true;

    // If this resource exports a child resource, the child's own exported
    // surface is transitively visible at this boundary.
    for (const exportedId of exportSet) {
      const traversalKey = `${ownerId}::${exportedId}::${targetId}`;
      if (seenPaths.has(traversalKey)) continue;
      seenPaths.add(traversalKey);

      if (
        this.isVisibleOutsideExportedResource(
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

  private isVisibleOutsideExportedResource(
    targetId: string,
    exportedResourceId: string,
    ownerId: string,
    seenPaths: Set<string>,
  ): boolean {
    const exportedSubtree = this.subtrees.get(exportedResourceId);
    if (!exportedSubtree?.has(targetId)) return false;

    const targetOwner = this.ownership.get(targetId)!;

    // For transitive checks we evaluate visibility from "outside the exported
    // resource but inside the owner".
    return this.isAccessibleFromOwnerChain(
      targetId,
      ownerId,
      targetOwner,
      exportedResourceId,
      seenPaths,
    );
  }

  /**
   * Validates that all dependency references respect visibility boundaries.
   * Called after registration is complete, before dependency computation.
   */
  validateVisibility(registry: StoreRegistry): void {
    this.validateItemDependencies(registry);
    this.validateHookEventVisibility(registry);
    this.validateMiddlewareVisibility(registry);
  }

  /**
   * Checks dependencies declared by all dependency-bearing definitions.
   */
  private validateItemDependencies(registry: StoreRegistry): void {
    const entries: Array<{
      consumerId: string;
      consumerType: string;
      dependencies: unknown;
    }> = [];

    for (const { task } of registry.tasks.values()) {
      entries.push({
        consumerId: task.id,
        consumerType: "Task",
        dependencies: task.dependencies,
      });
    }
    for (const { resource } of registry.resources.values()) {
      entries.push({
        consumerId: resource.id,
        consumerType: "Resource",
        dependencies: resource.dependencies,
      });
    }
    for (const { hook } of registry.hooks.values()) {
      entries.push({
        consumerId: hook.id,
        consumerType: "Hook",
        dependencies: hook.dependencies,
      });
    }
    for (const { middleware } of registry.taskMiddlewares.values()) {
      entries.push({
        consumerId: middleware.id,
        consumerType: "Task middleware",
        dependencies: middleware.dependencies,
      });
    }
    for (const { middleware } of registry.resourceMiddlewares.values()) {
      entries.push({
        consumerId: middleware.id,
        consumerType: "Resource middleware",
        dependencies: middleware.dependencies,
      });
    }

    for (const { consumerId, consumerType, dependencies } of entries) {
      if (!dependencies || typeof dependencies !== "object") continue;

      for (const [, depDef] of Object.entries(
        dependencies as Record<string, unknown>,
      )) {
        const dep = utils.isOptional(depDef)
          ? (depDef as { inner: unknown }).inner
          : depDef;

        const depId =
          dep && typeof dep === "object"
            ? resolveReferenceId(registry, dep)
            : undefined;

        if (!depId) continue;

        const violation = this.getAccessViolation(depId, consumerId);
        if (!violation) {
          continue;
        }

        this.throwAccessViolation({
          violation,
          targetId: depId,
          targetType: getItemTypeLabel(registry, depId),
          consumerId,
          consumerType,
        });
      }
    }
  }

  /**
   * Validates that hook listeners only subscribe to visible events.
   */
  private validateHookEventVisibility(registry: StoreRegistry): void {
    for (const { hook } of registry.hooks.values()) {
      if (!hook.on) continue;

      const events =
        hook.on === "*"
          ? Array.from(registry.events.values()).map((entry) => entry.event)
          : Array.isArray(hook.on)
            ? hook.on
            : [hook.on];
      for (const event of events) {
        const eventId = resolveReferenceId(registry, event)!;
        const violation = this.getAccessViolation(eventId, hook.id);
        if (!violation) {
          continue;
        }

        this.throwAccessViolation({
          violation,
          targetId: eventId,
          targetType: "Event",
          consumerId: hook.id,
          consumerType: "Hook",
        });
      }
    }
  }

  /**
   * Validates that middleware attachments are visible.
   */
  private validateMiddlewareVisibility(registry: StoreRegistry): void {
    for (const { task } of registry.tasks.values()) {
      for (const middlewareAttachment of task.middleware) {
        const middlewareId = resolveReferenceId(
          registry,
          middlewareAttachment,
        )!;
        const violation = this.getAccessViolation(middlewareId, task.id);
        if (!violation) {
          continue;
        }

        this.throwAccessViolation({
          violation,
          targetId: middlewareId,
          targetType: "Task middleware",
          consumerId: task.id,
          consumerType: "Task",
        });
      }
    }

    for (const { resource } of registry.resources.values()) {
      for (const middlewareAttachment of resource.middleware) {
        const middlewareId = resolveReferenceId(
          registry,
          middlewareAttachment,
        )!;
        const violation = this.getAccessViolation(middlewareId, resource.id);
        if (!violation) {
          continue;
        }

        this.throwAccessViolation({
          violation,
          targetId: middlewareId,
          targetType: "Resource middleware",
          consumerId: resource.id,
          consumerType: "Resource",
        });
      }
    }

    for (const { resource } of registry.resources.values()) {
      const ownerId = resource.id;
      const subtreePolicy = resource.subtree;
      if (!subtreePolicy) {
        continue;
      }

      for (const middlewareEntry of subtreePolicy.tasks?.middleware ?? []) {
        const middlewareAttachment =
          getSubtreeTaskMiddlewareAttachment(middlewareEntry);
        const middlewareId = resolveReferenceId(
          registry,
          middlewareAttachment,
        )!;
        const violation = this.getAccessViolation(middlewareId, ownerId);
        if (!violation) {
          continue;
        }

        this.throwAccessViolation({
          violation,
          targetId: middlewareId,
          targetType: "Task middleware",
          consumerId: ownerId,
          consumerType: "Resource",
        });
      }

      for (const middlewareEntry of subtreePolicy.resources?.middleware ?? []) {
        const middlewareAttachment =
          getSubtreeResourceMiddlewareAttachment(middlewareEntry);
        const middlewareId = resolveReferenceId(
          registry,
          middlewareAttachment,
        )!;
        const violation = this.getAccessViolation(middlewareId, ownerId);
        if (!violation) {
          continue;
        }

        this.throwAccessViolation({
          violation,
          targetId: middlewareId,
          targetType: "Resource middleware",
          consumerId: ownerId,
          consumerType: "Resource",
        });
      }
    }
  }

  private findIsolationViolation(
    targetId: string,
    consumerId: string,
  ): Extract<AccessViolation, { kind: "isolate" }> | null {
    const chain = this.getConsumerResourceChain(consumerId);
    if (chain.length === 0) {
      return null;
    }

    const targetTags = this.definitionTagIds.get(targetId);

    for (const policyResourceId of chain) {
      const policy = this.isolationPolicies.get(policyResourceId);
      if (!policy) {
        continue;
      }

      // --- deny rules ---
      if (policy.denyIds.has(targetId)) {
        return {
          kind: "isolate",
          policyResourceId,
          matchedRuleType: "id",
          matchedRuleId: targetId,
        };
      }

      if (policy.denyTagIds.has(targetId)) {
        return {
          kind: "isolate",
          policyResourceId,
          matchedRuleType: "tag",
          matchedRuleId: targetId,
        };
      }

      if (targetTags) {
        for (const tagId of targetTags) {
          if (!policy.denyTagIds.has(tagId)) {
            continue;
          }

          return {
            kind: "isolate",
            policyResourceId,
            matchedRuleType: "tag",
            matchedRuleId: tagId,
          };
        }
      }

      // --- deny subtree filters ---
      for (const filter of policy.denySubtreeFilters) {
        const filterSubtree = this.subtrees.get(filter.resourceId);
        // The resource itself is not in its own subtrees map, so check both.
        const inFilterSubtree =
          targetId === filter.resourceId || filterSubtree?.has(targetId);
        if (!inFilterSubtree) continue;
        if (filter.types && filter.types.length > 0) {
          const targetType = this.itemTypes.get(targetId);
          if (!targetType || !filter.types.includes(targetType)) continue;
        }
        return {
          kind: "isolate",
          policyResourceId,
          matchedRuleType: "subtree",
          matchedRuleId: filter.resourceId,
        };
      }

      // --- only rules: internal items (within the policy resource's subtree) are always allowed ---
      if (!policy.onlyMode) {
        continue;
      }

      const policySubtree = this.subtrees.get(policyResourceId);
      const isInternal =
        targetId === policyResourceId || policySubtree?.has(targetId) === true;

      if (isInternal) {
        continue;
      }

      // External target must match the only list (by id, tag, or subtree filter).
      const matchedByOnlyId = policy.onlyIds.has(targetId);
      const matchedByOnlyTag =
        policy.onlyTagIds.has(targetId) ||
        (targetTags !== undefined &&
          [...targetTags].some((tagId) => policy.onlyTagIds.has(tagId)));
      const matchedByOnlySubtree = policy.onlySubtreeFilters.some((filter) => {
        const filterSubtree = this.subtrees.get(filter.resourceId);
        // The resource itself is not in its own subtrees map, so check both.
        const inFilterSubtree =
          targetId === filter.resourceId || filterSubtree?.has(targetId);
        if (!inFilterSubtree) return false;
        if (filter.types && filter.types.length > 0) {
          const targetType = this.itemTypes.get(targetId);
          if (!targetType || !filter.types.includes(targetType)) return false;
        }
        return true;
      });

      if (!matchedByOnlyId && !matchedByOnlyTag && !matchedByOnlySubtree) {
        return {
          kind: "isolate",
          policyResourceId,
          matchedRuleType: "only",
          matchedRuleId: targetId,
        };
      }
    }

    return null;
  }

  private getConsumerResourceChain(consumerId: string): string[] {
    const chain: string[] = [];
    const seen = new Set<string>();

    let current: string | undefined = this.knownResources.has(consumerId)
      ? consumerId
      : this.ownership.get(consumerId);

    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      chain.push(current);
      current = this.ownership.get(current);
    }

    return chain;
  }

  private throwAccessViolation(data: {
    violation: AccessViolation;
    targetId: string;
    targetType: string;
    consumerId: string;
    consumerType: string;
  }): void {
    const { violation, targetId, targetType, consumerId, consumerType } = data;

    if (violation.kind === "visibility") {
      visibilityViolationError.throw({
        targetId,
        targetType,
        ownerResourceId: violation.targetOwnerResourceId,
        consumerId,
        consumerType,
        exportedIds: violation.exportedIds,
      });
    } else {
      isolateViolationError.throw({
        targetId,
        targetType,
        consumerId,
        consumerType,
        policyResourceId: violation.policyResourceId,
        matchedRuleType: violation.matchedRuleType,
        matchedRuleId: violation.matchedRuleId,
      });
    }
  }

  /**
   * Finds the first export set in the ownership chain that gates `targetId`.
   */
  private findGatingExportSet(targetId: string, ownerId: string): Set<string> {
    const exportSet = this.exportSets.get(ownerId);
    if (
      exportSet &&
      !this.isTargetAllowedByExports(targetId, ownerId, new Set())
    ) {
      return exportSet;
    }
    const parentOwner = this.ownership.get(ownerId);
    if (parentOwner === undefined) return new Set<string>();
    return this.findGatingExportSet(targetId, parentOwner);
  }

  /** Exposes the ownership map for testing. */
  getOwnership(): ReadonlyMap<string, string> {
    return this.ownership;
  }

  /** Exposes the export sets for testing. */
  getExportSets(): ReadonlyMap<string, ReadonlySet<string>> {
    return this.exportSets;
  }

  /**
   * Returns the owner resource id for an item id.
   */
  getOwnerResourceId(itemId: string): string | undefined {
    return this.ownership.get(itemId);
  }

  /**
   * Returns true when `itemId` is the same resource or is registered inside
   * the resource's registration subtree.
   */
  isWithinResourceSubtree(resourceId: string, itemId: string): boolean {
    if (resourceId === itemId) {
      return true;
    }
    return this.subtrees.get(resourceId)?.has(itemId) === true;
  }

  rollbackOwnershipTree(itemId: string): void {
    const toRemove = new Set<string>();
    if (this.ownership.has(itemId)) {
      toRemove.add(itemId);
    }

    let added = true;
    while (added) {
      added = false;
      for (const [id, ownerId] of this.ownership.entries()) {
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
      this.ownership.delete(id);
      this.exportSets.delete(id);
      this.subtrees.delete(id);
      this.knownResources.delete(id);
      this.isolationPolicies.delete(id);
      this.definitionTagIds.delete(id);
      this.itemTypes.delete(id);
    }

    for (const subtree of this.subtrees.values()) {
      for (const id of toRemove) {
        subtree.delete(id);
      }
    }
  }
}
