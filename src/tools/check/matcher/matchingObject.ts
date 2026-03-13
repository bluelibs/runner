import { OptionalPattern } from "./patterns";
import type { MatchContext, PathSegment } from "./shared";
import { appendPath, fail, formatPath, isPlainObject } from "./utils";

export function matchesObjectPattern(
  value: unknown,
  pattern: Record<string, unknown>,
  context: MatchContext,
  path: readonly PathSegment[],
  allowUnknownKeys: boolean,
  matchChild: (
    childValue: unknown,
    childPattern: unknown,
    childContext: MatchContext,
    childPath: readonly PathSegment[],
    parent?: unknown,
  ) => boolean,
  isMatchableObject: (value: unknown) => value is Record<string, unknown> = (
    candidate,
  ): candidate is Record<string, unknown> => isPlainObject(candidate),
): boolean {
  if (!isMatchableObject(value)) {
    return fail(context, path, "plain object", value);
  }

  const startFailures = context.failures.length;
  for (const key of Object.keys(value)) {
    if (key in pattern || allowUnknownKeys) continue;
    fail(
      context,
      appendPath(path, key),
      "known key",
      value[key],
      `Unknown key "${key}" found at ${formatPath(appendPath(path, key))}.`,
    );
    if (!context.collectAll) return false;
  }

  for (const [key, childPattern] of Object.entries(pattern)) {
    const hasOwnKey = Object.prototype.hasOwnProperty.call(value, key);
    if (!hasOwnKey) {
      if (childPattern instanceof OptionalPattern) continue;
      fail(
        context,
        appendPath(path, key),
        "defined value",
        undefined,
        `Missing required key "${key}" at ${formatPath(path)}.`,
      );
      if (!context.collectAll) return false;
      continue;
    }

    const matched = matchChild(
      value[key],
      childPattern,
      context,
      appendPath(path, key),
      value,
    );
    if (!matched && !context.collectAll) return false;
  }

  return context.failures.length === startFailures;
}
