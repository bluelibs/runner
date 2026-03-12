import { CheckOptionsError, MatchError, MatchPatternError } from "./errors";
import {
  setClassFieldPattern,
  setClassSchemaOptions,
  type MatchSchemaOptions,
} from "./classSchema";
import { isClassConstructor } from "../typeChecks";
import {
  ClassPattern,
  collectMatchFailures,
  collectMatchResult,
  isPlainObject,
  LazyPattern,
  matchAnyToken,
  matchEmailToken,
  matchIsoDateStringToken,
  matchIntegerToken,
  matchPositiveIntegerToken,
  matchNonEmptyStringToken,
  matchUrlToken,
  matchUuidToken,
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
} from "./matcher";
import { matchToJsonSchema } from "./toJsonSchema";
import type {
  CheckSchemaLike,
  CheckedValue,
  EnsurePatternOverlap,
  InferCheckSchema,
  InferMatchPattern,
  MatchCompiledSchema,
  MatchMessageOptions,
  MatchJsonSchema,
  MatchPattern,
  MatchPropertyDecorator,
  MatchSchemaDecorator,
  MatchToJsonSchemaOptions,
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

  // All internal Match patterns/tokens carry a `kind` string starting
  // with "Match." — skip them so they go through the normal pattern path.
  if (
    "kind" in value &&
    typeof (value as { kind: unknown }).kind === "string" &&
    (value as { kind: string }).kind.startsWith("Match.")
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
    const { failures, messageOverride } = collectMatchResult(
      input,
      this.pattern,
      false,
    );
    if (failures.length === 0) return input as InferMatchPattern<TPattern>;
    throw new MatchError(failures, messageOverride);
  }

  test(input: unknown): input is InferMatchPattern<TPattern> {
    return collectMatchFailures(input, this.pattern, false).length === 0;
  }

  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(this.pattern, options);
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

  const { failures, messageOverride } = collectMatchResult(
    value,
    pattern,
    throwAllErrors,
  );
  if (failures.length === 0) return value;
  throw new MatchError(failures, messageOverride);
}

function matchTest<TPattern extends MatchPattern>(
  value: unknown,
  pattern: TPattern,
): value is InferMatchPattern<TPattern> {
  return collectMatchFailures(value, pattern, false).length === 0;
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

function withMessage<TPattern extends MatchPattern>(
  pattern: TPattern,
  options: MatchMessageOptions<TPattern>,
): WithMessagePattern<TPattern> {
  assertPattern(
    isPlainObject(options),
    "Bad pattern: Match.WithMessage options must be a plain object.",
  );
  const error = options.error;
  assertPattern(
    typeof error === "string" || typeof error === "function",
    'Bad pattern: Match.WithMessage option "error" must be a string or function.',
  );
  return new WithMessagePattern(pattern, options as MatchMessageOptions);
}

function nonEmptyArray(): NonEmptyArrayPattern<undefined>;
function nonEmptyArray<TPattern extends MatchPattern>(
  pattern: TPattern,
): NonEmptyArrayPattern<TPattern>;
function nonEmptyArray(pattern?: MatchPattern): NonEmptyArrayPattern<unknown> {
  return new NonEmptyArrayPattern(pattern);
}

function arrayOf<TPattern extends MatchPattern>(
  pattern: TPattern,
): readonly [TPattern] {
  return [pattern] as const;
}

function regexpPattern(expression: RegExp | string): RegExpPattern<RegExp> {
  if (typeof expression === "string") {
    try {
      return new RegExpPattern(new RegExp(expression));
    } catch {
      throw new MatchPatternError(
        "Bad pattern: Match.RegExp requires a valid regular expression source string.",
      );
    }
  }

  if (expression instanceof RegExp) {
    return new RegExpPattern(expression);
  }

  throw new MatchPatternError(
    "Bad pattern: Match.RegExp requires a RegExp instance or source string.",
  );
}

function lazyPattern<TPattern extends MatchPattern>(
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

function fromSchema<TClass extends MatchSchemaClass>(
  target: TClass,
  options?: MatchSchemaOptions,
): ClassPattern<TClass>;
function fromSchema<TClass extends MatchSchemaClass>(
  target: MatchSchemaResolver<TClass>,
  options?: MatchSchemaOptions,
): LazyPattern<ClassPattern<TClass>>;
function fromSchema<TClass extends abstract new (...args: never[]) => unknown>(
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

function schemaDecorator(options?: MatchSchemaOptions): MatchSchemaDecorator {
  return (target) => {
    setClassSchemaOptions(target, options ?? {});
  };
}

function fieldDecorator<TPattern extends MatchPattern>(
  pattern: TPattern,
): MatchPropertyDecorator {
  return (target, key) => {
    if (typeof key !== "string") {
      throw new MatchPatternError(
        "Bad pattern: Match.Field supports string property names only.",
      );
    }

    const ctor = (
      typeof target === "function" ? target : target.constructor
    ) as abstract new (...args: never[]) => unknown;

    assertPattern(
      typeof ctor === "function",
      "Bad pattern: Match.Field can only be used on class members.",
    );

    setClassFieldPattern(ctor, key, pattern);
  };
}

function mapOf<TPattern extends MatchPattern>(
  pattern: TPattern,
): MapOfPattern<TPattern> {
  return new MapOfPattern(pattern);
}

function objectStrict<const TObjectPattern extends Record<string, unknown>>(
  pattern: TObjectPattern,
): ObjectStrictPattern<TObjectPattern> {
  assertPattern(
    isPlainObject(pattern),
    "Bad pattern: Match.ObjectStrict requires a plain object pattern.",
  );
  return new ObjectStrictPattern(pattern);
}

export const Match = Object.freeze({
  Any: matchAnyToken,
  ArrayOf: arrayOf,
  Email: matchEmailToken,
  IsoDateString: matchIsoDateStringToken,
  Integer: matchIntegerToken,
  PositiveInteger: matchPositiveIntegerToken,
  NonEmptyString: matchNonEmptyStringToken,
  RegExp: regexpPattern,
  Lazy: lazyPattern,
  fromSchema,
  Schema: schemaDecorator,
  fromClass: fromSchema,
  Class: schemaDecorator,
  Field: fieldDecorator,
  MapOf: mapOf,
  URL: matchUrlToken,
  UUID: matchUuidToken,
  NonEmptyArray: nonEmptyArray,
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
  WithMessage: withMessage,
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
  ): MatchCompiledSchema<TPattern> => compileMatchPattern(pattern),
  test: <TPattern extends MatchPattern>(
    value: unknown,
    pattern: TPattern,
  ): value is InferMatchPattern<TPattern> => matchTest(value, pattern),
  toJSONSchema: <TPattern extends MatchPattern>(
    pattern: TPattern,
    options?: MatchToJsonSchemaOptions,
  ): MatchJsonSchema => matchToJsonSchema(pattern, options),
  Error: MatchError,
});
