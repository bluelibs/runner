import { createMatchPatternError } from "../../errors";
import {
  appendIndex,
  throwUnsupported,
  withCycleGuard,
} from "../../toJsonSchema.helpers";
import { defineMatchPatternDefinition } from "../contracts";
import type { MatchContext } from "../shared";
import { fail, formatPath } from "../utils";
import {
  getMatchRangePatternError,
  isWhereCondition,
  type MatchRangePatternOptions,
  type RangeHolder,
  type RegExpHolder,
} from "./helpers";

export const oneOfPatternDefinition = defineMatchPatternDefinition<{
  patterns?: unknown;
}>({
  kind: "Match.OneOfPattern",
  match(pattern, value, context, path, parent, matchesPattern) {
    const candidates = Array.isArray(pattern.patterns) ? pattern.patterns : [];
    for (const candidatePattern of candidates) {
      const candidateContext: MatchContext = {
        failures: [],
        collectAll: true,
        activeComparisons: new WeakMap<object, WeakSet<object>>(),
      };
      if (
        matchesPattern(value, candidatePattern, candidateContext, path, parent)
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
  },
  compileToJSONSchema(pattern, context, path, _mode, compilePattern) {
    return withCycleGuard(pattern, context, path, () => {
      const candidates = Array.isArray(pattern.patterns)
        ? pattern.patterns
        : [];
      return {
        anyOf: candidates.map((candidatePattern, index) =>
          compilePattern(
            candidatePattern,
            context,
            appendIndex(path, index),
            "default",
          ),
        ),
      };
    });
  },
});

export const wherePatternDefinition = defineMatchPatternDefinition<{
  condition?: unknown;
}>({
  kind: "Match.WherePattern",
  match(pattern, value, context, path, parent) {
    if (!isWhereCondition(pattern.condition)) {
      return fail(
        context,
        path,
        "Match.Where condition",
        value,
        `Failed Match.Where validation at ${formatPath(path)}.`,
      );
    }

    try {
      if (pattern.condition(value, parent)) {
        return true;
      }
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
  },
  compileToJSONSchema(pattern, context, path) {
    if (!context.strict) {
      return {
        description:
          "Custom runtime predicate from Match.Where; not representable in strict JSON Schema.",
        "x-runner-match-kind": "Match.Where",
      };
    }

    throwUnsupported(
      path,
      "Match.Where relies on runtime predicates and cannot be represented in strict JSON Schema.",
      pattern,
    );
  },
});

export const regExpPatternDefinition =
  defineMatchPatternDefinition<RegExpHolder>({
    kind: "Match.RegExpPattern",
    match(pattern, value, context, path) {
      if (!(pattern.expression instanceof RegExp)) {
        throw createMatchPatternError(
          "Bad pattern: Match.RegExp requires a RegExp instance or source string.",
        );
      }
      if (typeof value !== "string") {
        return fail(context, path, "string matching regular expression", value);
      }

      pattern.expression.lastIndex = 0;
      const matched = pattern.expression.test(value);
      pattern.expression.lastIndex = 0;
      return matched
        ? true
        : fail(context, path, "string matching regular expression", value);
    },
    compileToJSONSchema(pattern, _context, path) {
      if (!(pattern.expression instanceof RegExp)) {
        throwUnsupported(
          path,
          "Match.RegExp requires a RegExp expression instance.",
          pattern,
        );
      }

      return {
        type: "string",
        pattern: pattern.expression.source,
        ...(pattern.expression.flags.length > 0
          ? {
              description:
                "Regex flags are not represented by JSON Schema pattern and are ignored during schema export.",
              "x-runner-match-kind": "Match.RegExp",
              "x-runner-regexp-flags": pattern.expression.flags,
            }
          : {}),
      };
    },
  });

function describeRangeExpected(pattern: {
  min?: number;
  max?: number;
  inclusive?: boolean;
}): string {
  const inclusive = pattern.inclusive !== false;

  if (pattern.min !== undefined && pattern.max !== undefined) {
    return inclusive
      ? `finite number between ${pattern.min} and ${pattern.max} (inclusive)`
      : `finite number greater than ${pattern.min} and less than ${pattern.max}`;
  }

  if (pattern.min !== undefined) {
    return inclusive
      ? `finite number greater than or equal to ${pattern.min}`
      : `finite number greater than ${pattern.min}`;
  }

  return inclusive
    ? `finite number less than or equal to ${pattern.max}`
    : `finite number less than ${pattern.max}`;
}

function normalizeRangePattern(pattern: RangeHolder): MatchRangePatternOptions {
  return {
    min: pattern.min as number | undefined,
    max: pattern.max as number | undefined,
    inclusive: pattern.inclusive as boolean | undefined,
  };
}

export const rangePatternDefinition = defineMatchPatternDefinition<RangeHolder>(
  {
    kind: "Match.RangePattern",
    match(pattern, value, context, path) {
      const optionsError = getMatchRangePatternError({
        min: pattern.min,
        max: pattern.max,
        inclusive: pattern.inclusive,
      });
      if (optionsError) {
        throw createMatchPatternError(optionsError);
      }

      const normalizedPattern = normalizeRangePattern(pattern);
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return fail(
          context,
          path,
          describeRangeExpected(normalizedPattern),
          value,
        );
      }

      const inclusive = normalizedPattern.inclusive !== false;
      if (
        normalizedPattern.min !== undefined &&
        (inclusive
          ? value < normalizedPattern.min
          : value <= normalizedPattern.min)
      ) {
        return fail(
          context,
          path,
          describeRangeExpected(normalizedPattern),
          value,
          `Failed Match.Range validation at ${formatPath(path)}.`,
        );
      }

      if (
        normalizedPattern.max !== undefined &&
        (inclusive
          ? value > normalizedPattern.max
          : value >= normalizedPattern.max)
      ) {
        return fail(
          context,
          path,
          describeRangeExpected(normalizedPattern),
          value,
          `Failed Match.Range validation at ${formatPath(path)}.`,
        );
      }

      return true;
    },
    compileToJSONSchema(pattern) {
      const normalizedPattern = normalizeRangePattern(pattern);
      const optionsError = getMatchRangePatternError(normalizedPattern);
      if (optionsError) {
        throw createMatchPatternError(optionsError);
      }

      const inclusive = normalizedPattern.inclusive !== false;
      return {
        type: "number",
        ...(normalizedPattern.min !== undefined
          ? inclusive
            ? { minimum: normalizedPattern.min }
            : { exclusiveMinimum: normalizedPattern.min }
          : {}),
        ...(normalizedPattern.max !== undefined
          ? inclusive
            ? { maximum: normalizedPattern.max }
            : { exclusiveMaximum: normalizedPattern.max }
          : {}),
      };
    },
  },
);
