import type {
  IsolationChannel,
  IsolationPolicy,
  RegisterableItem,
} from "../defs";
import type { StoreRegistry } from "./store/StoreRegistry";
import {
  getAccessViolation,
  getRootAccessInfo,
  hasExportsDeclaration,
  isAccessible,
} from "./visibility-tracker/accessEvaluator";
import type { AccessViolation } from "./visibility-tracker/contracts";
import {
  createVisibilityTrackerState,
  getOwnerResourceId,
  isWithinResourceSubtree,
  recordDefinitionTags,
  recordExports,
  recordIsolation,
  recordOwnership,
  recordResource,
  rollbackOwnershipTree,
} from "./visibility-tracker/state";
import { validateVisibility } from "./visibility-tracker/visibilityValidation";

export type { AccessViolation } from "./visibility-tracker/contracts";

/**
 * Tracks ownership and visibility boundaries for registered Runner definitions.
 *
 * During store registration, each definition is associated with the resource
 * subtree that registered it, along with any declared isolation policy,
 * exports surface, and definition tags. That accumulated state lets Runner
 * answer access checks, explain visibility violations, and validate
 * dependency wiring before the runtime starts serving work.
 *
 * @remarks
 * Definitions remain fully visible inside their owning resource subtree. When
 * a resource declares isolate exports, only explicitly exported definitions
 * stay reachable from outside that subtree.
 */
export class VisibilityTracker {
  private readonly state = createVisibilityTrackerState();

  /**
   * Records that a resource exists in the registration tree.
   *
   * @param resourceId - Canonical id of the resource being registered.
   */
  recordResource(resourceId: string): void {
    recordResource(this.state, resourceId);
  }

  /**
   * Records the tags attached to a definition so visibility validation can
   * classify references accurately.
   *
   * @param definitionId - Canonical id of the tagged definition.
   * @param tags - Tags attached to the definition during registration.
   */
  recordDefinitionTags(
    definitionId: string,
    tags: ReadonlyArray<{ id: string }>,
  ): void {
    recordDefinitionTags(this.state, definitionId, tags);
  }

  /**
   * Records the isolation policy declared by a resource.
   *
   * @param resourceId - Canonical id of the resource declaring isolation.
   * @param policy - Isolation policy to apply for that resource subtree.
   */
  recordIsolation(resourceId: string, policy?: IsolationPolicy): void {
    recordIsolation(this.state, resourceId, policy);
  }

  /**
   * Records which resource subtree owns a definition.
   *
   * Ownership is established when a resource registers an item into its local
   * graph, which later determines subtree visibility and export behavior.
   *
   * @param ownerResourceId - Canonical id of the resource registering the item.
   * @param item - Definition being registered into that resource subtree.
   */
  recordOwnership(ownerResourceId: string, item: RegisterableItem): void {
    recordOwnership(this.state, ownerResourceId, item);
  }

  /**
   * Records the explicit export surface for a resource subtree.
   *
   * @param resourceId - Canonical id of the resource declaring exports.
   * @param exports - Definitions or ids that remain visible outside the subtree.
   */
  recordExports(
    resourceId: string,
    exports: Array<RegisterableItem | string>,
  ): void {
    recordExports(this.state, resourceId, exports);
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
   *
   * @param targetId - Canonical id being requested through the runtime API.
   * @param rootId - Canonical id of the root app resource.
   * @returns Whether the target is root-accessible and which ids are exported.
   */
  getRootAccessInfo(
    targetId: string,
    rootId: string,
  ): { accessible: boolean; exportedIds: string[] } {
    return getRootAccessInfo(this.state, targetId, rootId);
  }

  /**
   * Returns whether a resource explicitly declares an isolate exports list.
   *
   * @param resourceId - Canonical id of the resource to inspect.
   * @returns True when the resource declared isolate exports, otherwise false.
   */
  hasExportsDeclaration(resourceId: string): boolean {
    return hasExportsDeclaration(this.state, resourceId);
  }

  /**
   * Checks whether `consumerId` can access `targetId`.
   *
   * An item is accessible if:
   * 1. The target's owner has no exports list (everything is public), OR
   * 2. The consumer is inside the same registration subtree as the target, OR
   * 3. The target is in the owner resource's export set (transitively up).
   *
   * @param targetId - Canonical id the consumer is trying to access.
   * @param consumerId - Canonical id requesting access to the target.
   * @param channel - Isolation channel used for the access check.
   * @returns True when the target is visible to the consumer on that channel.
   */
  isAccessible(
    targetId: string,
    consumerId: string,
    channel: IsolationChannel = "dependencies",
  ): boolean {
    return isAccessible(this.state, targetId, consumerId, channel);
  }

  /**
   * Returns a structured explanation for a failed visibility check.
   *
   * @param targetId - Canonical id the consumer is trying to access.
   * @param consumerId - Canonical id requesting access to the target.
   * @param channel - Isolation channel used for the access check.
   * @returns An access violation description, or `null` when access is allowed.
   */
  getAccessViolation(
    targetId: string,
    consumerId: string,
    channel: IsolationChannel = "dependencies",
  ): AccessViolation | null {
    return getAccessViolation(this.state, targetId, consumerId, channel);
  }

  /**
   * Validates that all dependency references respect visibility boundaries.
   * Called after registration is complete, before dependency computation.
   *
   * @param registry - Fully populated store registry to validate against.
   */
  validateVisibility(registry: StoreRegistry): void {
    validateVisibility(this.state, registry);
  }

  /**
   * Returns the canonical resource id that owns a definition.
   *
   * @param itemId - Canonical id of the definition to inspect.
   * @returns The owning resource id, or `undefined` when none is recorded.
   */
  getOwnerResourceId(itemId: string): string | undefined {
    return getOwnerResourceId(this.state, itemId);
  }

  /**
   * Returns whether a definition belongs to a resource's registration subtree.
   *
   * @param resourceId - Canonical id of the resource subtree root.
   * @param itemId - Canonical id of the definition being checked.
   * @returns True when the definition is owned within that subtree.
   */
  isWithinResourceSubtree(resourceId: string, itemId: string): boolean {
    return isWithinResourceSubtree(this.state, resourceId, itemId);
  }

  /**
   * Removes ownership records for a definition subtree.
   *
   * This is used when registration is rolled back and all descendant ownership
   * entries must disappear with the removed definition.
   *
   * @param itemId - Canonical id whose ownership subtree should be removed.
   */
  rollbackOwnershipTree(itemId: string): void {
    rollbackOwnershipTree(this.state, itemId);
  }
}
