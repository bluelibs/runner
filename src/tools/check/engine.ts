import { createMatchError } from "./errors";
import {
  ClassPattern,
  collectMatchResult,
  isPlainObject,
  matchAnyToken,
  matchEmailToken,
  matchIntegerToken,
  matchIsoDateStringToken,
  matchNonEmptyStringToken,
  matchPositiveIntegerToken,
  matchUrlToken,
  matchUuidToken,
  MaybePattern,
  ObjectIncludingPattern,
  OneOfPattern,
  OptionalPattern,
} from "./matcher";
import { matchToJsonSchema } from "./toJsonSchema";
import type {
  CheckSchemaLike,
  CheckedValue,
  DataOnly,
  EnsurePatternOverlap,
  InferCheckSchema,
  InferMatchPattern,
  MatchCompiledSchema,
  MatchJsonSchema,
  MatchPattern,
  MatchToJsonSchemaOptions,
} from "./types";
import {
  type CheckOptions,
  type MatchCompileOptions,
  isCheckSchemaLike,
  readOptions,
  resolveDefaultCollectAll,
} from "./checkOptions";
import { compileMatchPattern, matchTest } from "./compiledSchema";
import {
  arrayOf,
  assertPattern,
  fieldDecorator,
  fromSchema,
  lazyPattern,
  mapOf,
  nonEmptyArray,
  objectStrict,
  rangePattern,
  regexpPattern,
  schemaDecorator,
  where,
  withErrorPolicyPattern,
  withMessage,
} from "./patternFactories";

export type { CheckOptions, MatchCompileOptions } from "./checkOptions";

type NoInfer<T> = [T][T extends any ? 0 : never];

export function check<TSchema extends CheckSchemaLike<unknown>>(
  value: unknown,
  schema: TSchema,
  options?: CheckOptions,
): TSchema extends ClassPattern<any>
  ? DataOnly<InferCheckSchema<TSchema>>
  : InferCheckSchema<TSchema>;
export function check<TPattern extends MatchPattern, TValue>(
  value: TValue &
    EnsurePatternOverlap<TValue, InferMatchPattern<NoInfer<TPattern>>>,
  pattern: TPattern,
  options?: CheckOptions,
): CheckedValue<TValue, TPattern>;
export function check(
  value: unknown,
  pattern: unknown,
  options?: CheckOptions,
): unknown {
  const { errorPolicy, hasExplicitPolicy, maxDepth } = readOptions(options);

  if (isCheckSchemaLike(pattern)) {
    return pattern.parse(value);
  }

  const collectAll = hasExplicitPolicy
    ? errorPolicy === "all"
    : resolveDefaultCollectAll(pattern);

  const { failures, messageOverride } = collectMatchResult(
    value,
    pattern,
    collectAll,
    maxDepth,
  );
  if (failures.length === 0) return value;
  throw createMatchError(failures, messageOverride);
}

export const Match = Object.freeze({
  Any: matchAnyToken,
  Email: matchEmailToken,
  IsoDateString: matchIsoDateStringToken,
  Integer: matchIntegerToken,
  PositiveInteger: matchPositiveIntegerToken,
  NonEmptyString: matchNonEmptyStringToken,
  URL: matchUrlToken,
  UUID: matchUuidToken,
  NonEmptyArray: nonEmptyArray,
  RegExp: regexpPattern,
  Lazy: lazyPattern,
  fromSchema,
  Schema: schemaDecorator,
  /** @deprecated Use `Match.fromSchema` instead. */
  fromClass: fromSchema,
  /** @deprecated Use `Match.Schema` instead. */
  Class: schemaDecorator,
  Field: fieldDecorator,
  ArrayOf: arrayOf,
  MapOf: mapOf,
  Optional: <TPattern extends MatchPattern>(
    pattern: TPattern,
  ): OptionalPattern<TPattern> => new OptionalPattern(pattern),
  Maybe: <TPattern extends MatchPattern>(
    pattern: TPattern,
  ): MaybePattern<TPattern> => new MaybePattern(pattern),
  OneOf: <const TPatterns extends readonly MatchPattern[]>(
    ...patterns: TPatterns
  ): OneOfPattern<TPatterns> => {
    assertPattern(
      patterns.length > 0,
      "Bad pattern: Match.OneOf requires at least one candidate pattern.",
    );
    return new OneOfPattern(patterns);
  },
  Where: where,
  /** Matches finite numbers, or integers when `integer: true`, against optional min/max bounds. */
  Range: rangePattern,
  WithMessage: withMessage,
  WithErrorPolicy: withErrorPolicyPattern,
  ObjectIncluding: <const TObjectPattern extends Record<string, unknown>>(
    pattern: TObjectPattern,
  ): ObjectIncludingPattern<TObjectPattern> => {
    assertPattern(
      isPlainObject(pattern),
      "Bad pattern: Match.ObjectIncluding requires a plain object pattern.",
    );
    return new ObjectIncludingPattern(pattern);
  },
  ObjectStrict: objectStrict,
  compile: <TPattern extends MatchPattern>(
    pattern: TPattern,
    options?: MatchCompileOptions,
  ): MatchCompiledSchema<TPattern> => compileMatchPattern(pattern, options),
  test: <TPattern extends MatchPattern>(
    value: unknown,
    pattern: TPattern,
    options?: MatchCompileOptions,
  ): value is InferMatchPattern<TPattern> => matchTest(value, pattern, options),
  toJSONSchema: <TPattern extends MatchPattern>(
    pattern: TPattern,
    options?: MatchToJsonSchemaOptions,
  ): MatchJsonSchema => matchToJsonSchema(pattern, options),
});

// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace Match {
  /** Infers the parsed output type of a Match pattern or schema-like value. */
  type infer<TSchemaOrPattern> =
    TSchemaOrPattern extends CheckSchemaLike<unknown>
      ? InferCheckSchema<TSchemaOrPattern>
      : InferMatchPattern<TSchemaOrPattern>;
}
