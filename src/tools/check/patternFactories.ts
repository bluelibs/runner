import { createMatchPatternError } from "./errors";
import type { MatchSchemaOptions } from "./classSchema";
import { createEsFieldDecorator, createEsSchemaDecorator } from "./decorators";
import { isClassConstructor } from "../typeChecks";
import {
  ClassPattern,
  isPlainObject,
  LazyPattern,
  MapOfPattern,
  NonEmptyArrayPattern,
  ObjectStrictPattern,
  RangePattern,
  RegExpPattern,
  WherePattern,
  WithErrorPolicyPattern,
  WithMessagePattern,
} from "./matcher";
import { getMatchRangePatternError } from "./matcher/definitions/helpers";
import type {
  MatchMessageDescriptor,
  MatchMessageOptions,
  MatchPattern,
  MatchPropertyDecorator,
  MatchSchemaDecorator,
} from "./types";

type WherePredicate = (value: unknown) => boolean;
type WhereTypeGuard<TGuarded> = (value: unknown) => value is TGuarded;

export function assertPattern(condition: boolean, message: string): void {
  if (!condition) throw createMatchPatternError(message);
}

export function where<TGuarded>(
  condition: WhereTypeGuard<TGuarded>,
): WherePattern<TGuarded>;
export function where<TGuarded>(
  condition: WhereTypeGuard<TGuarded>,
  message: MatchMessageOptions<WherePattern<TGuarded>>,
): WithMessagePattern<WherePattern<TGuarded>>;
export function where(condition: WherePredicate): WherePattern<unknown>;
export function where(
  condition: WherePredicate,
  message: MatchMessageOptions<WherePattern<unknown>>,
): WithMessagePattern<WherePattern<unknown>>;
export function where(
  condition: unknown,
  message?: MatchMessageOptions<WherePattern<unknown>>,
): WherePattern<unknown> | WithMessagePattern<WherePattern<unknown>> {
  assertPattern(
    typeof condition === "function",
    "Bad pattern: Match.Where requires a function condition.",
  );

  const pattern = new WherePattern(condition as WherePredicate);
  if (message === undefined) {
    return pattern;
  }

  return withMessage(pattern, message);
}

export function withMessage<TPattern extends MatchPattern>(
  pattern: TPattern,
  message: MatchMessageOptions<TPattern>,
): WithMessagePattern<TPattern> {
  assertPattern(
    isValidMatchMessageValue(message),
    "Bad pattern: Match.WithMessage value must be a string, plain object, or function.",
  );
  return new WithMessagePattern(pattern, message as MatchMessageOptions);
}

function isValidMatchMessageValue(value: unknown): boolean {
  if (typeof value === "string" || typeof value === "function") {
    return true;
  }

  return isMatchMessageDescriptor(value);
}

function isMatchMessageDescriptor(
  value: unknown,
): value is MatchMessageDescriptor {
  if (!isPlainObject(value)) {
    return false;
  }

  if (typeof value.message !== "string") {
    return false;
  }

  if (value.code !== undefined && typeof value.code !== "string") {
    return false;
  }

  if (value.params !== undefined && !isPlainObject(value.params)) {
    return false;
  }

  return true;
}

export function withErrorPolicyPattern<TPattern extends MatchPattern>(
  pattern: TPattern,
  errorPolicy: "first" | "all",
): WithErrorPolicyPattern<TPattern> {
  assertPattern(
    errorPolicy === "first" || errorPolicy === "all",
    'Bad pattern: Match.WithErrorPolicy requires "first" or "all".',
  );

  return new WithErrorPolicyPattern(pattern, errorPolicy);
}

export function nonEmptyArray(): NonEmptyArrayPattern<undefined>;
export function nonEmptyArray<TPattern extends MatchPattern>(
  pattern: TPattern,
): NonEmptyArrayPattern<TPattern>;
export function nonEmptyArray(
  pattern?: MatchPattern,
): NonEmptyArrayPattern<unknown> {
  return new NonEmptyArrayPattern(pattern);
}

export function arrayOf<TPattern extends MatchPattern>(
  pattern: TPattern,
): readonly [TPattern] {
  return [pattern] as const;
}

export function regexpPattern(
  expression: RegExp | string,
): RegExpPattern<RegExp> {
  if (typeof expression === "string") {
    try {
      return new RegExpPattern(new RegExp(expression));
    } catch {
      throw createMatchPatternError(
        "Bad pattern: Match.RegExp requires a valid regular expression source string.",
      );
    }
  }

  if (expression instanceof RegExp) {
    return new RegExpPattern(expression);
  }

  throw createMatchPatternError(
    "Bad pattern: Match.RegExp requires a RegExp instance or source string.",
  );
}

/**
 * Creates a numeric matcher with optional minimum/maximum bounds.
 * Use `inclusive: false` when both bounds should be strict, and `integer: true`
 * when the range should only allow integers.
 */
export function rangePattern(options: {
  min?: number;
  max?: number;
  inclusive?: boolean;
  integer?: boolean;
}): RangePattern {
  const optionsError = getMatchRangePatternError(options);
  assertPattern(optionsError === null, optionsError ?? "Bad pattern.");
  return new RangePattern(options);
}

export function lazyPattern<TPattern extends MatchPattern>(
  resolver: () => TPattern,
): LazyPattern<TPattern> {
  assertPattern(
    typeof resolver === "function",
    "Bad pattern: Match.Lazy requires a resolver function.",
  );
  return new LazyPattern(resolver);
}

type MatchSchemaClass = abstract new (...args: never[]) => unknown;
type MatchSchemaResolver<TClass extends MatchSchemaClass = MatchSchemaClass> =
  () => TClass;

function resolveSchemaTarget<TClass extends MatchSchemaClass>(
  target: TClass | MatchSchemaResolver<TClass>,
): TClass {
  if (isClassConstructor(target)) {
    return target;
  }

  const resolved = target();
  assertPattern(
    isClassConstructor(resolved),
    "Bad pattern: Match.fromSchema resolver must return a class constructor.",
  );

  return resolved;
}

function isSchemaTargetResolver<TClass extends MatchSchemaClass>(
  target: TClass | MatchSchemaResolver<TClass>,
): target is MatchSchemaResolver<TClass> {
  return typeof target === "function" && !isClassConstructor(target);
}

function createSchemaPattern<TClass extends MatchSchemaClass>(
  target: TClass | MatchSchemaResolver<TClass>,
  options?: MatchSchemaOptions,
): ClassPattern<TClass> {
  return new ClassPattern(resolveSchemaTarget(target), options);
}

export function fromSchema<TClass extends MatchSchemaClass>(
  target: TClass,
  options?: MatchSchemaOptions,
): ClassPattern<TClass>;
export function fromSchema<TClass extends MatchSchemaClass>(
  target: MatchSchemaResolver<TClass>,
  options?: MatchSchemaOptions,
): LazyPattern<ClassPattern<TClass>>;
export function fromSchema<
  TClass extends abstract new (...args: never[]) => unknown,
>(
  target: TClass | MatchSchemaResolver<TClass>,
  options?: MatchSchemaOptions,
): ClassPattern<TClass> | LazyPattern<ClassPattern<TClass>> {
  assertPattern(
    typeof target === "function",
    "Bad pattern: Match.fromSchema requires a class constructor or resolver.",
  );

  if (isSchemaTargetResolver(target)) {
    return lazyPattern(() => createSchemaPattern(target, options));
  }

  return createSchemaPattern(target, options);
}

export function schemaDecorator(
  options?: MatchSchemaOptions,
): MatchSchemaDecorator {
  return createEsSchemaDecorator(options);
}

export function fieldDecorator<TPattern extends MatchPattern>(
  pattern: TPattern,
): MatchPropertyDecorator {
  return createEsFieldDecorator(pattern);
}

export function mapOf<TPattern extends MatchPattern>(
  pattern: TPattern,
): MapOfPattern<TPattern> {
  return new MapOfPattern(pattern);
}

export function objectStrict<
  const TObjectPattern extends Record<string, unknown>,
>(pattern: TObjectPattern): ObjectStrictPattern<TObjectPattern> {
  assertPattern(
    isPlainObject(pattern),
    "Bad pattern: Match.ObjectStrict requires a plain object pattern.",
  );
  return new ObjectStrictPattern(pattern);
}
