import type { MatchFailure } from "../errors";
import type { MatchContext, PathSegment } from "./shared";
import { isPlainObject } from "../../typeChecks";

export { isPlainObject };

export function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "Date";
  const valueType = typeof value;
  if (valueType !== "object") return valueType;
  const constructorName = (value as { constructor?: { name?: unknown } })
    .constructor?.name;
  return typeof constructorName === "string" && constructorName.length > 0
    ? constructorName
    : "object";
}

export function formatPath(path: readonly PathSegment[]): string {
  if (path.length === 0) return "$";
  let current = "$";
  for (const segment of path) {
    if (typeof segment === "number") {
      current += `[${segment}]`;
      continue;
    }
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
      current += `.${segment}`;
      continue;
    }
    current += `[${JSON.stringify(segment)}]`;
  }
  return current;
}

export function createFailure(
  path: readonly PathSegment[],
  expected: string,
  value: unknown,
  message?: string,
): MatchFailure {
  const renderedPath = formatPath(path);
  const actualType = describeType(value);
  return {
    path: renderedPath,
    expected,
    actualType,
    message:
      message ?? `Expected ${expected}, got ${actualType} at ${renderedPath}.`,
  };
}

export function fail(
  context: MatchContext,
  path: readonly PathSegment[],
  expected: string,
  value: unknown,
  message?: string,
): false {
  context.failures.push(createFailure(path, expected, value, message));
  return false;
}

export function appendPath(
  path: readonly PathSegment[],
  segment: PathSegment,
): PathSegment[] {
  return [...path, segment];
}

function isObjectReference(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

export function trackActiveComparison(
  context: MatchContext,
  value: unknown,
  pattern: unknown,
): (() => void) | "active" {
  if (!isObjectReference(value) || !isObjectReference(pattern)) {
    return () => undefined;
  }

  let patternSet = context.activeComparisons.get(value);
  if (!patternSet) {
    patternSet = new WeakSet<object>();
    context.activeComparisons.set(value, patternSet);
  }

  // We treat an already-seen pair as matched to prevent infinite recursion
  // while still allowing the surrounding branch to collect concrete failures.
  if (patternSet.has(pattern)) {
    return "active";
  }

  patternSet.add(pattern);
  return () => {
    patternSet?.delete(pattern);
  };
}
