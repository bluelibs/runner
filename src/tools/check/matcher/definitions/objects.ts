import { appendIndex, appendKey, throwUnsupported, withCycleGuard } from "../../toJsonSchema.helpers";
import { defineMatchPatternDefinition } from "../contracts";
import { appendPath, fail, formatPath, isPlainObject } from "../utils";
import { matchesObjectPattern } from "../matchingObject";
import { compileObjectPattern, type PatternHolder } from "./helpers";

export const objectIncludingPatternDefinition = defineMatchPatternDefinition<{
  pattern: Record<string, unknown>;
}>({
  kind: "Match.ObjectIncludingPattern",
  match(pattern, value, context, path, _parent, matchesPattern) {
    return matchesObjectPattern(
      value,
      pattern.pattern,
      context,
      path,
      true,
      matchesPattern,
    );
  },
  compileToJSONSchema(pattern, context, path, _mode, compilePattern) {
    return withCycleGuard(pattern, context, path, () => {
      if (!isPlainObject(pattern.pattern)) {
        throwUnsupported(
          path,
          "Match.ObjectIncluding requires a plain object pattern.",
          pattern,
        );
      }
      return compileObjectPattern(
        pattern.pattern,
        context,
        path,
        true,
        compilePattern,
      );
    });
  },
  appliesMessageOverrideToAggregate() {
    return true;
  },
});

export const objectStrictPatternDefinition = defineMatchPatternDefinition<{
  pattern: Record<string, unknown>;
}>({
  kind: "Match.ObjectStrictPattern",
  match(pattern, value, context, path, _parent, matchesPattern) {
    return matchesObjectPattern(
      value,
      pattern.pattern,
      context,
      path,
      false,
      matchesPattern,
    );
  },
  compileToJSONSchema(pattern, context, path, _mode, compilePattern) {
    return withCycleGuard(pattern, context, path, () => {
      if (!isPlainObject(pattern.pattern)) {
        throwUnsupported(
          path,
          "Match.ObjectStrict requires a plain object pattern.",
          pattern,
        );
      }
      return compileObjectPattern(
        pattern.pattern,
        context,
        path,
        false,
        compilePattern,
      );
    });
  },
  appliesMessageOverrideToAggregate() {
    return true;
  },
});

export const mapOfPatternDefinition =
  defineMatchPatternDefinition<PatternHolder>({
    kind: "Match.MapOfPattern",
    match(pattern, value, context, path, _parent, matchesPattern) {
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
    },
    compileToJSONSchema(pattern, context, path, _mode, compilePattern) {
      return withCycleGuard(pattern, context, path, () => ({
        type: "object",
        additionalProperties:
          pattern.pattern !== undefined
            ? compilePattern(
                pattern.pattern,
                context,
                appendKey(path, "[*]"),
                "default",
              )
            : {},
      }));
    },
    appliesMessageOverrideToAggregate() {
      return true;
    },
  });

export const nonEmptyArrayPatternDefinition =
  defineMatchPatternDefinition<PatternHolder>({
    kind: "Match.NonEmptyArrayPattern",
    match(pattern, value, context, path, _parent, matchesPattern) {
      if (!Array.isArray(value) || value.length === 0) {
        return fail(context, path, "non-empty array", value);
      }
      if (pattern.pattern === undefined) return true;
      const startFailures = context.failures.length;
      for (let index = 0; index < value.length; index += 1) {
        if (
          !matchesPattern(
            value[index],
            pattern.pattern,
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
    },
    compileToJSONSchema(pattern, context, path, _mode, compilePattern) {
      return withCycleGuard(pattern, context, path, () => ({
        type: "array",
        minItems: 1,
        ...(pattern.pattern !== undefined
          ? {
              items: compilePattern(
                pattern.pattern,
                context,
                appendIndex(path, 0),
                "default",
              ),
            }
          : {}),
      }));
    },
    appliesMessageOverrideToAggregate() {
      return true;
    },
  });
