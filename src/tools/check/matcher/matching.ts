import {
  createMatchPatternError,
  createMaxDepthExceededError,
} from "../errors";
import { isMatchDefinedPattern } from "./contracts";
import type { MatchContext, PathSegment } from "./shared";
import { describeType, fail, isPlainObject } from "./utils";
import { matchesObjectPattern } from "./matchingObject";

// Lazily allocated so primitive-only checks never pay for the maps.
// Returns the pattern set to release later, or undefined if the pair is
// already being compared (cycle).
function enterComparison(
  context: MatchContext,
  value: object,
  pattern: object,
): WeakSet<object> | undefined {
  const comparisons = (context.activeComparisons ??= new WeakMap());
  let patterns = comparisons.get(value);
  if (!patterns) {
    patterns = new WeakSet();
    comparisons.set(value, patterns);
  } else if (patterns.has(pattern)) {
    return undefined;
  }
  patterns.add(pattern);
  return patterns;
}

export function matchesPattern(
  value: unknown,
  pattern: unknown,
  context: MatchContext,
  path: readonly PathSegment[],
  parent?: unknown,
): boolean {
  // Depth guard: recursion follows attacker-controlled value nesting through
  // container/recursive patterns, so abort before the JS stack does.
  if (context.depth >= context.maxDepth) {
    throw createMaxDepthExceededError(context.maxDepth);
  }
  context.depth += 1;

  let activePatterns: WeakSet<object> | undefined;
  if (
    typeof value === "object" &&
    value !== null &&
    typeof pattern === "object" &&
    pattern !== null
  ) {
    activePatterns = enterComparison(context, value, pattern);
    // An already-seen pair is treated as matched to stop infinite recursion
    // while the surrounding branch still collects concrete failures.
    if (!activePatterns) {
      context.depth -= 1;
      return true;
    }
  }

  try {
    if (isMatchDefinedPattern(pattern)) {
      return pattern.match(value, context, path, parent, matchesPattern);
    }

    if (pattern === String) {
      return typeof value === "string"
        ? true
        : fail(context, path, "string", value);
    }
    if (pattern === Number) {
      return typeof value === "number"
        ? true
        : fail(context, path, "number", value);
    }
    if (pattern === Boolean) {
      return typeof value === "boolean"
        ? true
        : fail(context, path, "boolean", value);
    }
    if (pattern === Function) {
      return typeof value === "function"
        ? true
        : fail(context, path, "function", value);
    }
    if (pattern === Object) {
      return value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
        ? true
        : fail(context, path, "object", value);
    }
    if (pattern === Array) {
      return Array.isArray(value) ? true : fail(context, path, "array", value);
    }
    if (
      pattern === null ||
      pattern === undefined ||
      typeof pattern === "string" ||
      typeof pattern === "number" ||
      typeof pattern === "boolean" ||
      typeof pattern === "bigint" ||
      typeof pattern === "symbol"
    ) {
      return value === pattern
        ? true
        : fail(context, path, JSON.stringify(pattern), value);
    }
    if (Array.isArray(pattern)) {
      if (pattern.length !== 1) {
        throw createMatchPatternError(
          "Bad pattern: arrays must have exactly one type element.",
        );
      }
      if (!Array.isArray(value)) return fail(context, path, "array", value);

      const startFailures = context.failures.length;
      for (let index = 0; index < value.length; index += 1) {
        if (
          !matchesPattern(
            value[index],
            pattern[0],
            context,
            [...path, index],
            value,
          ) &&
          !context.collectAll
        ) {
          return false;
        }
      }
      return context.failures.length === startFailures;
    }
    if (isPlainObject(pattern)) {
      return matchesObjectPattern(
        value,
        pattern,
        context,
        path,
        false,
        matchesPattern,
      );
    }
    if (typeof pattern === "function") {
      try {
        return value instanceof pattern
          ? true
          : fail(
              context,
              path,
              `instance of ${pattern.name || "constructor"}`,
              value,
            );
      } catch {
        throw createMatchPatternError(
          `Bad pattern: constructor pattern "${pattern.name || "<anonymous>"}" is not valid.`,
        );
      }
    }

    throw createMatchPatternError(
      `Bad pattern: unsupported pattern type "${describeType(pattern)}".`,
    );
  } finally {
    context.depth -= 1;
    activePatterns?.delete(pattern as object);
  }
}
