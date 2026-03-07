import type { AnyResource, IsolationSubtreeFilter, ItemType } from "../defs";
import { validationError } from "../errors";
import { symbolIsolationSubtreeResource } from "../types/symbols";

const VALID_SUBTREE_FILTER_ITEM_TYPES = new Set<ItemType>([
  "task",
  "hook",
  "event",
  "tag",
  "resource",
  "taskMiddleware",
  "resourceMiddleware",
]);

function toDisplayValue(value: unknown): string {
  return typeof value === "string" && value.length > 0
    ? value
    : (JSON.stringify(value) ?? String(value));
}

export function isSubtreeFilterItemType(value: unknown): value is ItemType {
  return (
    typeof value === "string" &&
    VALID_SUBTREE_FILTER_ITEM_TYPES.has(value as ItemType)
  );
}

function normalizeSubtreeFilterTypes(
  types?: ReadonlyArray<ItemType>,
): ReadonlyArray<ItemType> | undefined {
  if (types === undefined) {
    return undefined;
  }

  if (!Array.isArray(types)) {
    validationError.throw({
      subject: "subtreeOf() types",
      id: toDisplayValue(types),
      originalError: "Expected an array of Runner item types.",
    });
  }

  const normalizedTypes = [...types];

  for (const type of normalizedTypes) {
    if (isSubtreeFilterItemType(type)) {
      continue;
    }

    validationError.throw({
      subject: "subtreeOf() types",
      id: toDisplayValue(type),
      originalError:
        'Expected only Runner item types: "task", "hook", "event", "tag", "resource", "taskMiddleware", or "resourceMiddleware".',
    });
  }

  return Object.freeze(normalizedTypes);
}

export function getSubtreeFilterResourceReference(
  filter: IsolationSubtreeFilter,
): AnyResource | undefined {
  const resource = (filter as unknown as Record<symbol, unknown>)[
    symbolIsolationSubtreeResource
  ];

  return resource && typeof resource === "object"
    ? (resource as AnyResource)
    : undefined;
}

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
  const filter: IsolationSubtreeFilter = {
    _subtreeFilter: true,
    resourceId: resource.id,
    types: normalizeSubtreeFilterTypes(options?.types),
  };

  Object.defineProperty(filter, symbolIsolationSubtreeResource, {
    value: resource,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return Object.freeze(filter);
}
