import type {
  RegisterableItems,
  IsolationSubtreeFilter,
  IResourceWithConfig,
} from "../defs";
import type { IsolationScope, IsolationScopeTarget } from "./scope";
import { isSubtreeFilter, isIsolationScope, isTag } from "../define";

export type ClassifiedIsolationEntry =
  | { kind: "scope"; scope: IsolationScope }
  | { kind: "subtreeFilter"; filter: IsolationSubtreeFilter }
  | { kind: "tag"; id: string; entry: RegisterableItems }
  | { kind: "definition"; id: string; entry: RegisterableItems }
  | { kind: "string"; value: string }
  | { kind: "unknown"; entry: unknown };

export type ClassifiedScopeTarget =
  | { kind: "subtreeFilter"; filter: IsolationSubtreeFilter }
  | { kind: "tag"; id: string; entry: RegisterableItems }
  | { kind: "definition"; id: string; entry: RegisterableItems }
  | { kind: "string"; value: string }
  | { kind: "unknown"; entry: unknown };

function extractItemId(item: RegisterableItems): string | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }
  if (
    "resource" in item &&
    typeof (item as IResourceWithConfig).resource?.id === "string"
  ) {
    return (item as IResourceWithConfig).resource.id;
  }
  if ("id" in item && typeof (item as { id: unknown }).id === "string") {
    return (item as { id: string }).id;
  }
  return undefined;
}

/**
 * Classifies an isolation policy entry into a discriminated union.
 * Used by both the policy validator (normalization) and the
 * VisibilityTracker (compilation into channel sets).
 */
export function classifyIsolationEntry(
  entry: unknown,
): ClassifiedIsolationEntry {
  if (isIsolationScope(entry)) {
    return { kind: "scope", scope: entry as IsolationScope };
  }
  if (isSubtreeFilter(entry)) {
    return { kind: "subtreeFilter", filter: entry };
  }
  if (typeof entry === "string") {
    return { kind: "string", value: entry };
  }
  const id = extractItemId(entry as RegisterableItems);
  if (!id) {
    return { kind: "unknown", entry };
  }
  if (isTag(entry)) {
    return { kind: "tag", id, entry: entry as RegisterableItems };
  }
  return { kind: "definition", id, entry: entry as RegisterableItems };
}

/**
 * Classifies a scope target (subset of isolation entries — no scope nesting).
 */
export function classifyScopeTarget(
  target: IsolationScopeTarget | unknown,
): ClassifiedScopeTarget {
  if (isSubtreeFilter(target)) {
    return { kind: "subtreeFilter", filter: target };
  }
  if (typeof target === "string") {
    return { kind: "string", value: target };
  }
  const id = extractItemId(target as RegisterableItems);
  if (!id) {
    return { kind: "unknown", entry: target };
  }
  if (isTag(target)) {
    return { kind: "tag", id, entry: target as RegisterableItems };
  }
  return { kind: "definition", id, entry: target as RegisterableItems };
}
