import type { DependencyMapType, RegisterableItem } from "../../defs";
import * as utils from "../../define";
import { validationError } from "../../errors";
import type { StoreRegistry } from "../store/StoreRegistry";

type ItemTypeRegistryKey =
  | "tasks"
  | "resources"
  | "events"
  | "hooks"
  | "taskMiddlewares"
  | "resourceMiddlewares"
  | "tags"
  | "errors"
  | "asyncContexts";

const ITEM_TYPE_REGISTRY_KEYS = [
  ["tasks", "Task"],
  ["resources", "Resource"],
  ["events", "Event"],
  ["hooks", "Hook"],
  ["taskMiddlewares", "Task middleware"],
  ["resourceMiddlewares", "Resource middleware"],
  ["tags", "Tag"],
  ["errors", "Error"],
  ["asyncContexts", "Async context"],
] as const satisfies ReadonlyArray<readonly [ItemTypeRegistryKey, string]>;

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

export function getItemTypeLabel(registry: StoreRegistry, id: string): string {
  for (const [registryKey, label] of ITEM_TYPE_REGISTRY_KEYS) {
    if (registry[registryKey].has(id)) {
      return label;
    }
  }

  throw validationError.new({
    subject: "VisibilityTracker target type",
    id,
    originalError:
      "Unable to resolve a registered item type label for the target id. This indicates an inconsistent visibility-validation state.",
  });
}

export function resolveDependencyReferenceIds(
  registry: StoreRegistry,
  dependencies: DependencyMapType | undefined,
): string[] {
  if (!dependencies) {
    return [];
  }

  const ids: string[] = [];

  for (const [, depDef] of Object.entries(dependencies)) {
    const dep = utils.isOptional(depDef)
      ? (depDef as { inner: unknown }).inner
      : depDef;
    const depId =
      dep && typeof dep === "object"
        ? resolveReferenceId(registry, dep)
        : undefined;

    if (depId) {
      ids.push(depId);
    }
  }

  return ids;
}

export function resolveTagReferenceIds(
  registry: StoreRegistry,
  tags: unknown,
): string[] {
  if (!Array.isArray(tags) || tags.length === 0) {
    return [];
  }

  return resolveReferenceIds(registry, tags);
}

export function resolveReferenceIds(
  registry: StoreRegistry,
  references: Iterable<unknown>,
): string[] {
  const ids: string[] = [];

  for (const reference of references) {
    const resolvedId = resolveReferenceId(registry, reference);
    if (resolvedId) {
      ids.push(resolvedId);
    }
  }

  return ids;
}

export function resolveSubtreeMiddlewareReferenceIds<TEntry>(
  registry: StoreRegistry,
  entries: readonly TEntry[],
  getAttachment: (entry: TEntry) => Pick<RegisterableItem, "id">,
): string[] {
  return resolveReferenceIds(
    registry,
    entries.map((entry) => getAttachment(entry)),
  );
}
