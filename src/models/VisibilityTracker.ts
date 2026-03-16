import type {
  IsolationChannel,
  IsolationPolicy,
  RegisterableItem,
} from "../defs";
import type { StoreRegistry } from "./StoreRegistry";
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
  private readonly state = createVisibilityTrackerState();

  recordResource(resourceId: string): void {
    recordResource(this.state, resourceId);
  }

  recordDefinitionTags(
    definitionId: string,
    tags: ReadonlyArray<{ id: string }>,
  ): void {
    recordDefinitionTags(this.state, definitionId, tags);
  }

  recordIsolation(resourceId: string, policy?: IsolationPolicy): void {
    recordIsolation(this.state, resourceId, policy);
  }

  recordOwnership(ownerResourceId: string, item: RegisterableItem): void {
    recordOwnership(this.state, ownerResourceId, item);
  }

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
   */
  getRootAccessInfo(
    targetId: string,
    rootId: string,
  ): { accessible: boolean; exportedIds: string[] } {
    return getRootAccessInfo(this.state, targetId, rootId);
  }

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
   */
  isAccessible(
    targetId: string,
    consumerId: string,
    channel: IsolationChannel = "dependencies",
  ): boolean {
    return isAccessible(this.state, targetId, consumerId, channel);
  }

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
   */
  validateVisibility(registry: StoreRegistry): void {
    validateVisibility(this.state, registry);
  }

  getOwnerResourceId(itemId: string): string | undefined {
    return getOwnerResourceId(this.state, itemId);
  }

  isWithinResourceSubtree(resourceId: string, itemId: string): boolean {
    return isWithinResourceSubtree(this.state, resourceId, itemId);
  }

  rollbackOwnershipTree(itemId: string): void {
    rollbackOwnershipTree(this.state, itemId);
  }
}
