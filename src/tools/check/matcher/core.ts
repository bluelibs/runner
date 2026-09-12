import type { MatchFailure, MatchMessageOverride } from "../errors";
import { matchesPattern } from "./matching";
import { DEFAULT_MATCH_MAX_DEPTH, type MatchContext } from "./shared";

export interface MatchResult {
  failures: MatchFailure[];
  messageOverride?: MatchMessageOverride;
}

export function collectMatchResult(
  value: unknown,
  pattern: unknown,
  collectAll: boolean,
  maxDepth: number = DEFAULT_MATCH_MAX_DEPTH,
): MatchResult {
  const context: MatchContext = {
    failures: [],
    collectAll,
    activeComparisons: new WeakMap<object, WeakSet<object>>(),
    depth: 0,
    maxDepth,
  };

  const matches = matchesPattern(value, pattern, context, []);
  if (matches) return { failures: [] };

  return {
    failures: collectAll ? context.failures : [context.failures[0]],
    messageOverride: context.messageOverride,
  };
}

export function collectMatchFailures(
  value: unknown,
  pattern: unknown,
  collectAll: boolean,
  maxDepth?: number,
): MatchFailure[] {
  return collectMatchResult(value, pattern, collectAll, maxDepth).failures;
}
