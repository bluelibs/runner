import { RegisterableItems, IResourceWithConfig } from "../defs";
import * as utils from "../define";
import { visibilityViolationError } from "../errors";
import { StoreRegistry } from "./StoreRegistry";

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

/**
 * Tracks which resource owns (registered) each item and which items
 * are exported by resources that declare an exports list.
 *
 * Ownership is established during registration: when resource R calls
 * `.register([item])`, item is "owned" by R.
 *
 * When R declares `.exports([subset])`, only those items are visible
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
   * exported item ids. Resources without `.exports()` are absent
   * from this map (meaning "everything is public").
   */
  private readonly exportSets = new Map<string, Set<string>>();

  /**
   * Maps resource id → set of all item ids in its registration subtree
   * (including items registered by nested child resources).
   */
  private readonly subtrees = new Map<string, Set<string>>();

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
   * Records the export set for a resource that declares `.exports()`.
   */
  recordExports(resourceId: string, exports: Array<RegisterableItems>): void {
    const ids = new Set<string>();
    for (const item of exports) {
      const id = getItemId(item);
      if (id) ids.add(id);
    }
    this.exportSets.set(resourceId, ids);
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
    const targetOwner = this.ownership.get(targetId);
    // Items not tracked (global builtins) are always accessible
    if (targetOwner === undefined) return true;

    return this.isAccessibleFromOwnerChain(
      targetId,
      consumerId,
      targetOwner,
      undefined,
      new Set<string>(),
    );
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

      for (const depDef of Object.values(
        dependencies as Record<string, unknown>,
      )) {
        const dep = utils.isOptional(depDef)
          ? (depDef as { inner: unknown }).inner
          : depDef;

        const depId =
          dep && typeof dep === "object" && "id" in dep
            ? (dep as { id: string }).id
            : undefined;

        if (!depId) continue;
        if (this.isAccessible(depId, consumerId)) continue;

        const targetOwner = this.ownership.get(depId)!;
        const exportSet = this.findGatingExportSet(depId, targetOwner);

        visibilityViolationError.throw({
          targetId: depId,
          targetType: getItemTypeLabel(registry, depId),
          ownerResourceId: targetOwner,
          consumerId,
          consumerType,
          exportedIds: [...exportSet],
        });
      }
    }
  }

  /**
   * Validates that hook listeners only subscribe to visible events.
   */
  private validateHookEventVisibility(registry: StoreRegistry): void {
    for (const { hook } of registry.hooks.values()) {
      if (!hook.on || hook.on === "*") continue;

      const events = Array.isArray(hook.on) ? hook.on : [hook.on];
      for (const event of events) {
        const eventId = event.id;
        if (this.isAccessible(eventId, hook.id)) continue;

        const targetOwner = this.ownership.get(eventId)!;
        const exportSet = this.findGatingExportSet(eventId, targetOwner);

        visibilityViolationError.throw({
          targetId: eventId,
          targetType: "Event",
          ownerResourceId: targetOwner,
          consumerId: hook.id,
          consumerType: "Hook",
          exportedIds: [...exportSet],
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
        if (this.isAccessible(middlewareAttachment.id, task.id)) continue;

        const targetOwner = this.ownership.get(middlewareAttachment.id)!;
        const exportSet = this.findGatingExportSet(
          middlewareAttachment.id,
          targetOwner,
        );

        visibilityViolationError.throw({
          targetId: middlewareAttachment.id,
          targetType: "Task middleware",
          ownerResourceId: targetOwner,
          consumerId: task.id,
          consumerType: "Task",
          exportedIds: [...exportSet],
        });
      }
    }

    for (const { resource } of registry.resources.values()) {
      for (const middlewareAttachment of resource.middleware) {
        if (this.isAccessible(middlewareAttachment.id, resource.id)) continue;

        const targetOwner = this.ownership.get(middlewareAttachment.id)!;
        const exportSet = this.findGatingExportSet(
          middlewareAttachment.id,
          targetOwner,
        );

        visibilityViolationError.throw({
          targetId: middlewareAttachment.id,
          targetType: "Resource middleware",
          ownerResourceId: targetOwner,
          consumerId: resource.id,
          consumerType: "Resource",
          exportedIds: [...exportSet],
        });
      }
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
}
