import { throwUnsupported, withCycleGuard } from "../../toJsonSchema.helpers";
import {
  defineMatchPatternDefinition,
  shouldPatternApplyMessageOverrideToAggregate,
} from "../contracts";
import type {
  LazyHolder,
  WithErrorPolicyHolder,
  WithMessageHolder,
} from "./helpers";
import { isResolver, maybeApplyPatternMessageOverride } from "./helpers";

export const maybePatternDefinition = defineMatchPatternDefinition<{
  pattern: unknown;
}>({
  kind: "Match.MaybePattern",
  match(pattern, value, context, path, parent, matchesPattern) {
    return value === undefined || value === null
      ? true
      : matchesPattern(value, pattern.pattern, context, path, parent);
  },
  compileToJSONSchema(pattern, context, path, mode, compilePattern) {
    if (mode !== "object-property") {
      throwUnsupported(
        path,
        "Match.Maybe can only be converted when used as an object property pattern.",
        pattern,
      );
    }

    return withCycleGuard(pattern, context, path, () => ({
      anyOf: [
        compilePattern(pattern.pattern, context, path, "default"),
        { type: "null" },
      ],
    }));
  },
  appliesMessageOverrideToAggregate(pattern) {
    return shouldPatternApplyMessageOverrideToAggregate(pattern.pattern);
  },
  isOptionalObjectProperty() {
    return true;
  },
});

export const optionalPatternDefinition = defineMatchPatternDefinition<{
  pattern: unknown;
}>({
  kind: "Match.OptionalPattern",
  match(pattern, value, context, path, parent, matchesPattern) {
    return value === undefined
      ? true
      : matchesPattern(value, pattern.pattern, context, path, parent);
  },
  compileToJSONSchema(pattern, context, path, mode, compilePattern) {
    if (mode !== "object-property") {
      throwUnsupported(
        path,
        "Match.Optional can only be converted when used as an object property pattern.",
        pattern,
      );
    }

    return withCycleGuard(pattern, context, path, () =>
      compilePattern(pattern.pattern, context, path, "default"),
    );
  },
  appliesMessageOverrideToAggregate(pattern) {
    return shouldPatternApplyMessageOverrideToAggregate(pattern.pattern);
  },
  isOptionalObjectProperty() {
    return true;
  },
});

export const withMessagePatternDefinition =
  defineMatchPatternDefinition<WithMessageHolder>({
    kind: "Match.WithMessagePattern",
    match(pattern, value, context, path, parent, matchesPattern) {
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
    },
    compileToJSONSchema(pattern, context, path, mode, compilePattern) {
      return withCycleGuard(pattern, context, path, () =>
        compilePattern(pattern.pattern, context, path, mode),
      );
    },
    appliesMessageOverrideToAggregate(pattern) {
      return shouldPatternApplyMessageOverrideToAggregate(pattern.pattern);
    },
  });

export const withErrorPolicyPatternDefinition =
  defineMatchPatternDefinition<WithErrorPolicyHolder>({
    kind: "Match.WithErrorPolicyPattern",
    match(pattern, value, context, path, parent, matchesPattern) {
      return matchesPattern(value, pattern.pattern, context, path, parent);
    },
    compileToJSONSchema(pattern, context, path, mode, compilePattern) {
      return withCycleGuard(pattern, context, path, () =>
        compilePattern(pattern.pattern, context, path, mode),
      );
    },
    appliesMessageOverrideToAggregate(pattern) {
      return shouldPatternApplyMessageOverrideToAggregate(pattern.pattern);
    },
  });

export const lazyPatternDefinition = defineMatchPatternDefinition<LazyHolder>({
  kind: "Match.LazyPattern",
  match(pattern, value, context, path, parent, matchesPattern) {
    const resolver = pattern.resolve;
    return matchesPattern(
      value,
      isResolver(resolver) ? resolver.call(pattern) : undefined,
      context,
      path,
      parent,
    );
  },
  compileToJSONSchema(pattern, context, path, mode, compilePattern) {
    const resolver = pattern.resolve;
    if (!isResolver(resolver)) {
      throwUnsupported(
        path,
        "Match.Lazy requires a resolver function.",
        pattern,
      );
    }

    return withCycleGuard(pattern, context, path, () =>
      compilePattern(resolver.call(pattern), context, path, mode),
    );
  },
  appliesMessageOverrideToAggregate() {
    return true;
  },
});
