import type { AnyResource, IsolationSubtreeFilter, ItemType } from "../defs";

/**
 * Creates an `IsolationSubtreeFilter` that targets every item registered
 * inside `resource`'s registration subtree.
 *
 * Unlike string selectors, this binds to the resource object — so overridable
 * ids or any nested child registration is caught automatically at bootstrap,
 * regardless of what the concrete id strings look like at runtime.
 *
 * @example
 * ```ts
 * import { subtreeOf, defineResource, defineTask } from "@bluelibs/runner";
 *
 * const agentResource = defineResource({ id: "agent", register: [agentTask] });
 *
 * // Deny all tasks from agentResource's subtree
 * const boundary = defineResource({
 *   id: "my.boundary",
 *   register: [consumerTask],
 *   isolate: { deny: [subtreeOf(agentResource, { types: ["task"] })] },
 * });
 *
 * // Only allow events from agentResource's subtree (plus internal items)
 * const strict = defineResource({
 *   id: "strict.consumer",
 *   register: [listenerTask],
 *   isolate: { only: [subtreeOf(agentResource, { types: ["event"] })] },
 * });
 * ```
 */
export function subtreeOf(
  resource: AnyResource,
  options?: { readonly types?: ReadonlyArray<ItemType> },
): IsolationSubtreeFilter {
  return {
    _subtreeFilter: true,
    resourceId: resource.id,
    types: options?.types,
  };
}
