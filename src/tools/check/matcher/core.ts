import type { MatchFailure } from "../errors";
import { matchesPattern } from "./matching";
import type { MatchContext } from "./shared";

export function collectMatchFailures(
  value: unknown,
  pattern: unknown,
  collectAll: boolean,
): MatchFailure[] {
  const context: MatchContext = {
    failures: [],
    collectAll,
    activeComparisons: new WeakMap<object, WeakSet<object>>(),
  };

  const matches = matchesPattern(value, pattern, context, []);
  if (matches) return [];
  return collectAll ? context.failures : [context.failures[0]];
}
