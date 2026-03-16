import type { MatchFailure, MatchMessageOverride } from "../errors";
import type { InferMatchPattern } from "../types";

export type PathSegment = string | number;

export type NonEmptyArrayElement<TPattern> = [TPattern] extends [undefined]
  ? unknown
  : InferMatchPattern<TPattern>;

export type MatchContext = {
  failures: MatchFailure[];
  collectAll: boolean;
  activeComparisons: WeakMap<object, WeakSet<object>>;
  messageOverride?: MatchMessageOverride;
};

export type WhereCondition<TGuarded = unknown> =
  | ((value: unknown, parent?: unknown) => boolean)
  | ((value: unknown, parent?: unknown) => value is TGuarded);

// ── Regex constants shared by matching and JSON Schema conversion ────────────

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ISO_DATE_STRING_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;

// ── Shared ClassPattern helper ───────────────────────────────────────────────

/**
 * Resolves whether unknown keys should be allowed for a ClassPattern match.
 * Used by both runtime matching and JSON Schema conversion.
 */
export function resolveClassAllowUnknownKeys(
  patternExact: boolean | undefined,
  schemaExact: boolean,
): boolean {
  if (patternExact === true) return false;
  if (patternExact === false) return true;
  return !schemaExact;
}
