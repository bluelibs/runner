import {
  DependencyAccessPolicy,
  RegisterableItems,
  IResourceWithConfig,
} from "../defs";
import * as utils from "../define";
import {
  dependencyAccessPolicyViolationError,
  visibilityViolationError,
} from "../errors";
import { StoreRegistry } from "./StoreRegistry";

const INTERNAL_DEPENDENCY_PREFIX = "__runner";

type CompiledDependencyAccessPolicy = {
  denyIds: Set<string>;
  denyTagIds: Set<string>;
};

type AccessViolation =
  | {
      kind: "visibility";
      targetOwnerResourceId: string;
      exportedIds: string[];
    }
  | {
      kind: "dependencyAccessPolicy";
      policyResourceId: string;
      matchedRuleType: "id" | "tag";
      matchedRuleId: string;
    };

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
   * Registered resource ids. Used to detect consumer resource boundaries
   * (including root resources with no owner).
   */
  private readonly knownResources = new Set<string>();

  /**
   * Resource id -> compiled additive dependency access policy.
   */
  private readonly dependencyAccessPolicies = new Map<
    string,
    CompiledDependencyAccessPolicy
  >();

  /**
   * Definition id -> tag ids carried by that definition.
   */
  private readonly definitionTagIds = new Map<string, Set<string>>();

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

  recordDependencyAccessPolicy(
    resourceId: string,
    policy?: DependencyAccessPolicy,
  ): void {
    this.knownResources.add(resourceId);

    if (!policy || !Array.isArray(policy.deny) || policy.deny.length === 0) {
      this.dependencyAccessPolicies.delete(resourceId);
      return;
    }

    const denyIds = new Set<string>();
    const denyTagIds = new Set<string>();

    for (const entry of policy.deny) {
      if (typeof entry === "string") {
        denyIds.add(entry);
        continue;
      }

      const maybeId = getItemId(entry as RegisterableItems);
      if (!maybeId) {
        continue;
      }

      if (utils.isTag(entry)) {
        denyTagIds.add(maybeId);
      } else {
        denyIds.add(maybeId);
      }
    }

    this.dependencyAccessPolicies.set(resourceId, { denyIds, denyTagIds });
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

    return this.findDependencyAccessPolicyViolation(targetId, consumerId);
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

      for (const [depKey, depDef] of Object.entries(
        dependencies as Record<string, unknown>,
      )) {
        if (depKey.startsWith(INTERNAL_DEPENDENCY_PREFIX)) {
          continue;
        }

        const dep = utils.isOptional(depDef)
          ? (depDef as { inner: unknown }).inner
          : depDef;

        const depId =
          dep && typeof dep === "object" && "id" in dep
            ? (dep as { id: string }).id
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
      if (!hook.on || hook.on === "*") continue;

      const events = Array.isArray(hook.on) ? hook.on : [hook.on];
      for (const event of events) {
        const eventId = event.id;
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
        const violation = this.getAccessViolation(
          middlewareAttachment.id,
          task.id,
        );
        if (!violation) {
          continue;
        }

        this.throwAccessViolation({
          violation,
          targetId: middlewareAttachment.id,
          targetType: "Task middleware",
          consumerId: task.id,
          consumerType: "Task",
        });
      }
    }

    for (const { resource } of registry.resources.values()) {
      for (const middlewareAttachment of resource.middleware) {
        const violation = this.getAccessViolation(
          middlewareAttachment.id,
          resource.id,
        );
        if (!violation) {
          continue;
        }

        this.throwAccessViolation({
          violation,
          targetId: middlewareAttachment.id,
          targetType: "Resource middleware",
          consumerId: resource.id,
          consumerType: "Resource",
        });
      }
    }
  }

  private findDependencyAccessPolicyViolation(
    targetId: string,
    consumerId: string,
  ): Extract<AccessViolation, { kind: "dependencyAccessPolicy" }> | null {
    const chain = this.getConsumerResourceChain(consumerId);
    if (chain.length === 0) {
      return null;
    }

    const targetTags = this.definitionTagIds.get(targetId);

    for (const policyResourceId of chain) {
      const policy = this.dependencyAccessPolicies.get(policyResourceId);
      if (!policy) {
        continue;
      }

      if (policy.denyIds.has(targetId)) {
        return {
          kind: "dependencyAccessPolicy",
          policyResourceId,
          matchedRuleType: "id",
          matchedRuleId: targetId,
        };
      }

      if (policy.denyTagIds.has(targetId)) {
        return {
          kind: "dependencyAccessPolicy",
          policyResourceId,
          matchedRuleType: "tag",
          matchedRuleId: targetId,
        };
      }

      if (!targetTags) {
        continue;
      }

      for (const tagId of targetTags) {
        if (!policy.denyTagIds.has(tagId)) {
          continue;
        }

        return {
          kind: "dependencyAccessPolicy",
          policyResourceId,
          matchedRuleType: "tag",
          matchedRuleId: tagId,
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
      dependencyAccessPolicyViolationError.throw({
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
}
