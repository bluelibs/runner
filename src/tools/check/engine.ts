import { CheckOptionsError, MatchError, MatchPatternError } from "./errors";
import {
  collectMatchFailures,
  isPlainObject,
  matchAnyToken,
  matchEmailToken,
  matchIsoDateStringToken,
  matchIntegerToken,
  matchNonEmptyStringToken,
  matchUrlToken,
  matchUuidToken,
  MaybePattern,
  NonEmptyArrayPattern,
  ObjectIncludingPattern,
  OneOfPattern,
  OptionalPattern,
  WherePattern,
} from "./matcher";
import { matchToJsonSchema } from "./toJsonSchema";
import type {
  CheckSchemaLike,
  CheckedValue,
  EnsurePatternOverlap,
  InferCheckSchema,
  InferMatchPattern,
  MatchCompiledSchema,
  MatchJsonSchema,
  MatchPattern,
} from "./types";

export interface CheckOptions {
  throwAllErrors?: boolean;
}

type WherePredicate = (value: unknown) => boolean;
type WhereTypeGuard<TGuarded> = (value: unknown) => value is TGuarded;
type NoInfer<T> = [T][T extends any ? 0 : never];

function assertPattern(condition: boolean, message: string): void {
  if (!condition) throw new MatchPatternError(message);
}

function readOptions(options?: CheckOptions): { throwAllErrors: boolean } {
  if (options === undefined) return { throwAllErrors: false };
  if (!isPlainObject(options)) {
    throw new CheckOptionsError("check() options must be a plain object.");
  }

  const throwAllErrors = (options as { throwAllErrors?: unknown })
    .throwAllErrors;
  if (throwAllErrors !== undefined && typeof throwAllErrors !== "boolean") {
    throw new CheckOptionsError(
      'check() option "throwAllErrors" must be a boolean when provided.',
    );
  }
  return { throwAllErrors: throwAllErrors === true };
}

function isCheckSchemaLike(value: unknown): value is CheckSchemaLike<unknown> {
  if (value === null || typeof value !== "object") return false;
  if (
    value instanceof OptionalPattern ||
    value instanceof MaybePattern ||
    value instanceof OneOfPattern ||
    value instanceof WherePattern ||
    value instanceof ObjectIncludingPattern ||
    value instanceof NonEmptyArrayPattern
  ) {
    return false;
  }

  const candidate = value as {
    parse?: unknown;
    toJSONSchema?: unknown;
  };

  if (typeof candidate.parse !== "function") return false;
  if (
    candidate.toJSONSchema !== undefined &&
    typeof candidate.toJSONSchema !== "function"
  ) {
    return false;
  }

  // Keep plain object patterns deterministic unless the intent is explicit.
  if (!isPlainObject(value)) return true;
  const keys = Object.keys(value);
  return keys.every((key) => key === "parse" || key === "toJSONSchema");
}

class CompiledMatchPatternSchema<
  TPattern extends MatchPattern,
> implements MatchCompiledSchema<TPattern> {
  constructor(public readonly pattern: TPattern) {}

  parse(input: unknown): InferMatchPattern<TPattern> {
    const failures = collectMatchFailures(input, this.pattern, false);
    if (failures.length === 0) return input as InferMatchPattern<TPattern>;
    throw new MatchError(failures);
  }

  toJSONSchema(): MatchJsonSchema {
    return matchToJsonSchema(this.pattern);
  }
}

function compileMatchPattern<TPattern extends MatchPattern>(
  pattern: TPattern,
): MatchCompiledSchema<TPattern> {
  return Object.freeze(new CompiledMatchPatternSchema(pattern));
}

export function check<TSchema extends CheckSchemaLike<unknown>>(
  value: unknown,
  schema: TSchema,
  options?: CheckOptions,
): InferCheckSchema<TSchema>;
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
  const { throwAllErrors } = readOptions(options);

  if (isCheckSchemaLike(pattern)) {
    return pattern.parse(value);
  }

  const failures = collectMatchFailures(value, pattern, throwAllErrors);
  if (failures.length === 0) return value;
  throw new MatchError(failures);
}

function matchTest<TPattern extends MatchPattern>(
  value: unknown,
  pattern: TPattern,
): value is InferMatchPattern<TPattern> {
  try {
    check(value, pattern);
    return true;
  } catch (error) {
    if (error instanceof MatchError) return false;
    throw error;
  }
}

type MatchWhere = {
  <TGuarded>(condition: WhereTypeGuard<TGuarded>): WherePattern<TGuarded>;
  (condition: WherePredicate): WherePattern<unknown>;
};

const where: MatchWhere = (condition: unknown): WherePattern<unknown> => {
  assertPattern(
    typeof condition === "function",
    "Bad pattern: Match.Where requires a function condition.",
  );
  return new WherePattern(condition as WherePredicate);
};

function nonEmptyArray(): NonEmptyArrayPattern<undefined>;
function nonEmptyArray<TPattern extends MatchPattern>(
  pattern: TPattern,
): NonEmptyArrayPattern<TPattern>;
function nonEmptyArray(pattern?: MatchPattern): NonEmptyArrayPattern<unknown> {
  return new NonEmptyArrayPattern(pattern);
}

export const Match = Object.freeze({
  Any: matchAnyToken,
  Email: matchEmailToken,
  IsoDateString: matchIsoDateStringToken,
  Integer: matchIntegerToken,
  NonEmptyString: matchNonEmptyStringToken,
  URL: matchUrlToken,
  UUID: matchUuidToken,
  NonEmptyArray: nonEmptyArray,
  Optional: <TPattern extends MatchPattern>(
    pattern: TPattern,
  ): OptionalPattern<TPattern> => new OptionalPattern(pattern),
  Maybe: <TPattern extends MatchPattern>(
    pattern: TPattern,
  ): MaybePattern<TPattern> => new MaybePattern(pattern),
  OneOf: <TPatterns extends readonly MatchPattern[]>(
    ...patterns: TPatterns
  ): OneOfPattern<TPatterns> => {
    assertPattern(
      patterns.length > 0,
      "Bad pattern: Match.OneOf requires at least one candidate pattern.",
    );
    return new OneOfPattern(patterns);
  },
  Where: where,
  ObjectIncluding: <TObjectPattern extends Record<string, unknown>>(
    pattern: TObjectPattern,
  ): ObjectIncludingPattern<TObjectPattern> => {
    assertPattern(
      isPlainObject(pattern),
      "Bad pattern: Match.ObjectIncluding requires a plain object pattern.",
    );
    return new ObjectIncludingPattern(pattern);
  },
  compile: <TPattern extends MatchPattern>(
    pattern: TPattern,
  ): MatchCompiledSchema<TPattern> => compileMatchPattern(pattern),
  test: <TPattern extends MatchPattern>(
    value: unknown,
    pattern: TPattern,
  ): value is InferMatchPattern<TPattern> => matchTest(value, pattern),
  toJSONSchema: <TPattern extends MatchPattern>(
    pattern: TPattern,
  ): MatchJsonSchema => matchToJsonSchema(pattern),
  Error: MatchError,
});
