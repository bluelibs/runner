import {
  createCheckOptionsError,
  createMatchError,
  createMatchPatternError,
} from "./errors";
import {
  getClassSchemaDefinition,
  type MatchSchemaOptions,
} from "./classSchema";
import { createEsFieldDecorator, createEsSchemaDecorator } from "./decorators";
import { hydrateMatchedValue } from "./hydration";
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
  WithErrorPolicyPattern,
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
  MatchMessageDescriptor,
  MatchMessageOptions,
  MatchJsonSchema,
  MatchPattern,
  MatchPropertyDecorator,
  MatchSchemaDecorator,
  MatchToJsonSchemaOptions,
} from "./types";

export interface CheckOptions {
  errorPolicy?: "first" | "all";
  /** @deprecated Use errorPolicy instead. */
  throwAllErrors?: boolean;
}

type WherePredicate = (value: unknown) => boolean;
type WhereTypeGuard<TGuarded> = (value: unknown) => value is TGuarded;
type NoInfer<T> = [T][T extends any ? 0 : never];

function assertPattern(condition: boolean, message: string): void {
  if (!condition) throw createMatchPatternError(message);
}

type ResolvedCheckOptions = {
  errorPolicy?: "first" | "all";
  hasExplicitPolicy: boolean;
};

function readOptions(options?: CheckOptions): ResolvedCheckOptions {
  if (options === undefined) {
    return { errorPolicy: undefined, hasExplicitPolicy: false };
  }
  if (!isPlainObject(options)) {
    throw createCheckOptionsError("check() options must be a plain object.");
  }

  const errorPolicy = (options as { errorPolicy?: unknown }).errorPolicy;
  if (
    errorPolicy !== undefined &&
    errorPolicy !== "first" &&
    errorPolicy !== "all"
  ) {
    throw createCheckOptionsError(
      'check() option "errorPolicy" must be "first" or "all" when provided.',
    );
  }

  const throwAllErrors = (options as { throwAllErrors?: unknown })
    .throwAllErrors;
  if (throwAllErrors !== undefined && typeof throwAllErrors !== "boolean") {
    throw createCheckOptionsError(
      'check() option "throwAllErrors" must be a boolean when provided.',
    );
  }

  if (errorPolicy !== undefined) {
    return { errorPolicy, hasExplicitPolicy: true };
  }

  if (throwAllErrors !== undefined) {
    return {
      errorPolicy: throwAllErrors ? "all" : "first",
      hasExplicitPolicy: true,
    };
  }

  return { errorPolicy: undefined, hasExplicitPolicy: false };
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
    const collectAll = resolveDefaultCollectAll(this.pattern);
    const { failures, messageOverride } = collectMatchResult(
      input,
      this.pattern,
      collectAll,
    );
    if (failures.length === 0) {
      return hydrateMatchedValue(
        input,
        this.pattern,
      ) as InferMatchPattern<TPattern>;
    }
    throw createMatchError(failures, messageOverride);
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

function resolvePatternDefaultErrorPolicy(
  pattern: unknown,
): "first" | "all" | undefined {
  if (pattern instanceof WithErrorPolicyPattern) {
    return pattern.errorPolicy;
  }

  if (pattern instanceof WithMessagePattern) {
    return resolvePatternDefaultErrorPolicy(pattern.pattern);
  }

  if (pattern instanceof LazyPattern) {
    return resolvePatternDefaultErrorPolicy(pattern.resolve());
  }

  if (pattern instanceof ClassPattern) {
    if (pattern.options?.errorPolicy !== undefined) {
      return pattern.options.errorPolicy;
    }
    if (pattern.options?.throwAllErrors !== undefined) {
      return pattern.options.throwAllErrors ? "all" : "first";
    }
    return getClassSchemaDefinition(pattern.ctor).errorPolicy;
  }

  return undefined;
}

function resolveDefaultCollectAll(pattern: unknown): boolean {
  return resolvePatternDefaultErrorPolicy(pattern) === "all";
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
  const { errorPolicy, hasExplicitPolicy } = readOptions(options);

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
  );
  if (failures.length === 0) return value;
  throw createMatchError(failures, messageOverride);
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

function withErrorPolicyPattern<TPattern extends MatchPattern>(
  pattern: TPattern,
  errorPolicy: "first" | "all",
): WithErrorPolicyPattern<TPattern> {
  assertPattern(
    errorPolicy === "first" || errorPolicy === "all",
    'Bad pattern: Match.WithErrorPolicy requires "first" or "all".',
  );

  return new WithErrorPolicyPattern(pattern, errorPolicy);
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
  return createEsSchemaDecorator(options);
}

function fieldDecorator<TPattern extends MatchPattern>(
  pattern: TPattern,
): MatchPropertyDecorator {
  return createEsFieldDecorator(pattern);
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
  ): MatchCompiledSchema<TPattern> => compileMatchPattern(pattern),
  test: <TPattern extends MatchPattern>(
    value: unknown,
    pattern: TPattern,
  ): value is InferMatchPattern<TPattern> => matchTest(value, pattern),
  toJSONSchema: <TPattern extends MatchPattern>(
    pattern: TPattern,
    options?: MatchToJsonSchemaOptions,
  ): MatchJsonSchema => matchToJsonSchema(pattern, options),
});
