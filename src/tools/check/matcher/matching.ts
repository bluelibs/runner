import {
  createMatchError,
  createMatchPatternError,
  type MatchFailure,
} from "../errors";
import { getClassSchemaDefinition } from "../classSchema";
import {
  ClassPattern,
  WithErrorPolicyPattern,
  LazyPattern,
  MapOfPattern,
  MaybePattern,
  NonEmptyArrayPattern,
  ObjectIncludingPattern,
  ObjectStrictPattern,
  OneOfPattern,
  OptionalPattern,
  RegExpPattern,
  WithMessagePattern,
  WherePattern,
} from "./patterns";
import type {
  MatchMessageContext,
  MatchMessageDescriptor,
  MatchPattern,
} from "../types";
import {
  EMAIL_PATTERN,
  ISO_DATE_STRING_PATTERN,
  UUID_PATTERN,
  resolveClassAllowUnknownKeys,
  type MatchContext,
  type PathSegment,
} from "./shared";
import {
  matchAnyToken,
  matchEmailToken,
  matchIntegerToken,
  matchIsoDateStringToken,
  matchNonEmptyStringToken,
  matchPositiveIntegerToken,
  matchUrlToken,
  matchUuidToken,
} from "./tokens";
import {
  appendPath,
  describeType,
  fail,
  formatPath,
  isPlainObject,
  trackActiveComparison,
} from "./utils";
import { matchesObjectPattern } from "./matchingObject";

function matchArrayElements(
  value: unknown[],
  elementPattern: unknown,
  context: MatchContext,
  path: readonly PathSegment[],
): boolean {
  const startFailures = context.failures.length;
  for (let index = 0; index < value.length; index += 1) {
    if (
      !matchesPattern(
        value[index],
        elementPattern,
        context,
        appendPath(path, index),
        value,
      ) &&
      !context.collectAll
    ) {
      return false;
    }
  }
  return context.failures.length === startFailures;
}

export function matchesPattern(
  value: unknown,
  pattern: unknown,
  context: MatchContext,
  path: readonly PathSegment[],
  parent?: unknown,
): boolean {
  const releaseActiveComparison = trackActiveComparison(
    context,
    value,
    pattern,
  );
  if (releaseActiveComparison === "active") return true;
  try {
    if (pattern === matchAnyToken) return true;
    if (pattern === matchIntegerToken) {
      return Number.isInteger(value) &&
        typeof value === "number" &&
        value <= 2147483647 &&
        value >= -2147483648
        ? true
        : fail(context, path, "32-bit integer", value);
    }
    if (pattern === matchPositiveIntegerToken) {
      return Number.isInteger(value) && typeof value === "number" && value >= 0
        ? true
        : fail(context, path, "non-negative integer", value);
    }
    if (pattern === matchNonEmptyStringToken) {
      return typeof value === "string" && value.length > 0
        ? true
        : fail(context, path, "non-empty string", value);
    }
    if (pattern === matchEmailToken) {
      return typeof value === "string" && EMAIL_PATTERN.test(value)
        ? true
        : fail(context, path, "email", value);
    }
    if (pattern === matchUuidToken) {
      return typeof value === "string" && UUID_PATTERN.test(value)
        ? true
        : fail(context, path, "uuid", value);
    }
    if (pattern === matchUrlToken) {
      if (typeof value !== "string") return fail(context, path, "url", value);
      try {
        new URL(value);
        return true;
      } catch {
        return fail(context, path, "url", value);
      }
    }
    if (pattern === matchIsoDateStringToken) {
      if (typeof value !== "string" || !ISO_DATE_STRING_PATTERN.test(value)) {
        return fail(context, path, "ISO date string", value);
      }
      return Number.isFinite(Date.parse(value))
        ? true
        : fail(context, path, "ISO date string", value);
    }
    if (pattern instanceof OptionalPattern) {
      return value === undefined
        ? true
        : matchesPattern(value, pattern.pattern, context, path, parent);
    }
    if (pattern instanceof MaybePattern) {
      return value === undefined || value === null
        ? true
        : matchesPattern(value, pattern.pattern, context, path, parent);
    }
    if (pattern instanceof OneOfPattern) {
      for (const candidatePattern of pattern.patterns) {
        const candidateContext: MatchContext = {
          failures: [],
          collectAll: true,
          activeComparisons: new WeakMap<object, WeakSet<object>>(),
        };
        if (
          matchesPattern(
            value,
            candidatePattern,
            candidateContext,
            path,
            parent,
          )
        ) {
          return true;
        }
      }
      return fail(
        context,
        path,
        "one of the provided patterns",
        value,
        `Failed Match.OneOf validation at ${formatPath(path)}.`,
      );
    }
    if (pattern instanceof WithMessagePattern) {
      const failuresBefore = context.failures.length;
      const matched = matchesPattern(
        value,
        pattern.pattern,
        context,
        path,
        parent,
      );
      if (!matched && context.failures.length > failuresBefore) {
        maybeApplyPatternMessageOverride(
          pattern,
          value,
          parent,
          context,
          failuresBefore,
        );
      }
      return matched;
    }
    if (pattern instanceof WithErrorPolicyPattern) {
      return matchesPattern(value, pattern.pattern, context, path, parent);
    }
    if (pattern instanceof MapOfPattern) {
      if (!isPlainObject(value)) {
        return fail(
          context,
          path,
          "plain object (Record)",
          value,
          `Expected a plain object for Match.MapOf at ${formatPath(path)}.`,
        );
      }
      let allMatch = true;
      for (const [key, entryValue] of Object.entries(value)) {
        if (
          !matchesPattern(
            entryValue,
            pattern.pattern,
            context,
            appendPath(path, key),
            value,
          )
        ) {
          allMatch = false;
          if (!context.collectAll) break;
        }
      }
      return allMatch;
    }
    if (pattern instanceof WherePattern) {
      try {
        if (pattern.condition(value, parent)) return true;
      } catch (error) {
        return fail(
          context,
          path,
          "Match.Where condition",
          value,
          `Failed Match.Where validation at ${formatPath(path)}: ${String(error)}.`,
        );
      }
      return fail(
        context,
        path,
        "Match.Where condition",
        value,
        `Failed Match.Where validation at ${formatPath(path)}.`,
      );
    }
    if (pattern instanceof LazyPattern) {
      return matchesPattern(value, pattern.resolve(), context, path, parent);
    }
    if (pattern instanceof ClassPattern) {
      const classSchema = getClassSchemaDefinition(pattern.ctor);
      const allowUnknownKeys = resolveClassAllowUnknownKeys(
        pattern.options?.exact,
        classSchema.exact,
      );
      return matchesObjectPattern(
        value,
        classSchema.pattern,
        context,
        path,
        allowUnknownKeys,
        matchesPattern,
      );
    }
    if (pattern instanceof RegExpPattern) {
      if (typeof value !== "string") {
        return fail(context, path, "string matching regular expression", value);
      }
      // Global/sticky expressions carry mutable cursor state between calls.
      pattern.expression.lastIndex = 0;
      const matched = pattern.expression.test(value);
      pattern.expression.lastIndex = 0;
      return matched
        ? true
        : fail(context, path, "string matching regular expression", value);
    }
    if (pattern instanceof ObjectIncludingPattern) {
      return matchesObjectPattern(
        value,
        pattern.pattern,
        context,
        path,
        true,
        matchesPattern,
      );
    }
    if (pattern instanceof ObjectStrictPattern) {
      return matchesObjectPattern(
        value,
        pattern.pattern,
        context,
        path,
        false,
        matchesPattern,
      );
    }
    if (pattern instanceof NonEmptyArrayPattern) {
      if (!Array.isArray(value) || value.length === 0) {
        return fail(context, path, "non-empty array", value);
      }
      if (pattern.pattern === undefined) return true;
      return matchArrayElements(value, pattern.pattern, context, path);
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
      return matchArrayElements(value, pattern[0], context, path);
    }
    if (isPlainObject(pattern)) {
      // Plain object patterns use ObjectStrict semantics by default.
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
    releaseActiveComparison();
  }
}

function maybeApplyPatternMessageOverride(
  pattern: WithMessagePattern<MatchPattern>,
  value: unknown,
  parent: unknown,
  context: MatchContext,
  failuresBefore: number,
): void {
  const firstNewFailure = context.failures[failuresBefore];
  const firstFailure = context.failures[0];
  if (failuresBefore > 0 && firstNewFailure !== firstFailure) {
    return;
  }

  const messageOption = pattern.message;
  const appliesToAggregate = shouldApplyMessageOverrideToAggregate(
    pattern.pattern,
  );
  if (typeof messageOption !== "function") {
    const resolvedMessage = normalizeMatchMessageValue(messageOption);
    applyMatchMessageOverride(
      context,
      context.failures.slice(failuresBefore),
      resolvedMessage,
      appliesToAggregate,
    );
    return;
  }

  const nestedFailures = context.failures.slice(failuresBefore);
  const nestedError = createMatchError(nestedFailures);
  const errorContext: MatchMessageContext = {
    value,
    parent,
    error: nestedError,
    path: nestedError.data.path,
    pattern: pattern.pattern,
  };

  let resolvedMessage: unknown;
  try {
    resolvedMessage = messageOption(errorContext);
  } catch (error) {
    throw createMatchPatternError(
      `Bad pattern: Match.WithMessage formatter threw: ${String(error)}`,
    );
  }

  if (
    typeof resolvedMessage !== "string" &&
    !isMatchMessageDescriptor(resolvedMessage)
  ) {
    throw createMatchPatternError(
      "Bad pattern: Match.WithMessage formatter must return a string or plain object.",
    );
  }

  applyMatchMessageOverride(
    context,
    nestedFailures,
    normalizeMatchMessageValue(resolvedMessage),
    appliesToAggregate,
  );
}

function applyMatchMessageOverride(
  context: MatchContext,
  nestedFailures: MatchFailure[],
  resolvedMessage: MatchMessageDescriptor,
  appliesToAggregate: boolean,
): void {
  context.messageOverride = {
    message: resolvedMessage.message,
    appliesToAggregate,
  };

  for (const failure of nestedFailures) {
    if (failure.code === undefined && resolvedMessage.code !== undefined) {
      failure.code = resolvedMessage.code;
    }

    if (failure.params === undefined && resolvedMessage.params !== undefined) {
      failure.params = resolvedMessage.params;
    }
  }
}

function normalizeMatchMessageValue(
  value: string | MatchMessageDescriptor,
): MatchMessageDescriptor {
  return typeof value === "string" ? { message: value } : value;
}

function isMatchMessageDescriptor(
  value: unknown,
): value is MatchMessageDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const typedValue = value as {
    message?: unknown;
    code?: unknown;
    params?: unknown;
  };

  if (typeof typedValue.message !== "string") {
    return false;
  }

  if (typedValue.code !== undefined && typeof typedValue.code !== "string") {
    return false;
  }

  if (
    typedValue.params !== undefined &&
    (!typedValue.params ||
      typeof typedValue.params !== "object" ||
      Array.isArray(typedValue.params))
  ) {
    return false;
  }

  return true;
}

function shouldApplyMessageOverrideToAggregate(pattern: unknown): boolean {
  if (
    pattern instanceof OptionalPattern ||
    pattern instanceof MaybePattern ||
    pattern instanceof WithMessagePattern
  ) {
    return shouldApplyMessageOverrideToAggregate(pattern.pattern);
  }

  if (pattern instanceof LazyPattern) return true;
  if (pattern instanceof ClassPattern) return true;
  if (pattern instanceof MapOfPattern) return true;
  if (pattern instanceof ObjectIncludingPattern) return true;
  if (pattern instanceof ObjectStrictPattern) return true;
  if (pattern instanceof NonEmptyArrayPattern) return true;

  if (pattern === Object || pattern === Array) return true;
  if (Array.isArray(pattern)) return true;
  if (isPlainObject(pattern)) return true;

  return false;
}
