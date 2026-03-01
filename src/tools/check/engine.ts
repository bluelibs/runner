import { CheckOptionsError, MatchError, MatchPatternError } from "./errors";
import {
  collectMatchFailures,
  isPlainObject,
  matchAnyToken,
  matchIntegerToken,
  matchNonEmptyStringToken,
  MaybePattern,
  ObjectIncludingPattern,
  OneOfPattern,
  OptionalPattern,
  WherePattern,
} from "./matcher";
import type {
  CheckedValue,
  EnsurePatternOverlap,
  InferMatchPattern,
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

export function check<TPattern extends MatchPattern, TValue>(
  value: TValue &
    EnsurePatternOverlap<TValue, InferMatchPattern<NoInfer<TPattern>>>,
  pattern: TPattern,
  options?: CheckOptions,
): CheckedValue<TValue, TPattern> {
  const { throwAllErrors } = readOptions(options);
  const failures = collectMatchFailures(value, pattern, throwAllErrors);
  if (failures.length === 0) return value as CheckedValue<TValue, TPattern>;
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

export const Match = Object.freeze({
  Any: matchAnyToken,
  Integer: matchIntegerToken,
  NonEmptyString: matchNonEmptyStringToken,
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
  test: <TPattern extends MatchPattern>(
    value: unknown,
    pattern: TPattern,
  ): value is InferMatchPattern<TPattern> => matchTest(value, pattern),
  Error: MatchError,
});
