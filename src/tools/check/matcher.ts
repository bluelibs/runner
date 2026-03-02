import { MatchError, MatchFailure, MatchPatternError } from "./errors";
import { matchToJsonSchema } from "./toJsonSchema";
import type {
  InferMatchPattern,
  MatchJsonSchema,
  MatchToJsonSchemaOptions,
} from "./types";
type PathSegment = string | number;
type NonEmptyArrayElement<TPattern> = [TPattern] extends [undefined]
  ? unknown
  : InferMatchPattern<TPattern>;
type MatchContext = {
  failures: MatchFailure[];
  collectAll: boolean;
};
type WhereCondition<TGuarded = unknown> =
  | ((value: unknown) => boolean)
  | ((value: unknown) => value is TGuarded);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_STRING_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;
export const matchAnyToken = Object.freeze({
  kind: "Match.Any",
  parse(value: unknown): unknown {
    return parsePatternValue(value, matchAnyToken);
  },
  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(matchAnyToken, options);
  },
});
export const matchIntegerToken = Object.freeze({
  kind: "Match.Integer",
  parse(value: unknown): number {
    return parsePatternValue(value, matchIntegerToken);
  },
  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(matchIntegerToken, options);
  },
});
export const matchPositiveIntegerToken = Object.freeze({
  kind: "Match.PositiveInteger",
  parse(value: unknown): number {
    return parsePatternValue(value, matchPositiveIntegerToken);
  },
  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(matchPositiveIntegerToken, options);
  },
});
export const matchNonEmptyStringToken = Object.freeze({
  kind: "Match.NonEmptyString",
  parse(value: unknown): string {
    return parsePatternValue(value, matchNonEmptyStringToken);
  },
  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(matchNonEmptyStringToken, options);
  },
});
export const matchEmailToken = Object.freeze({
  kind: "Match.Email",
  parse(value: unknown): string {
    return parsePatternValue(value, matchEmailToken);
  },
  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(matchEmailToken, options);
  },
});
export const matchUuidToken = Object.freeze({
  kind: "Match.UUID",
  parse(value: unknown): string {
    return parsePatternValue(value, matchUuidToken);
  },
  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(matchUuidToken, options);
  },
});
export const matchUrlToken = Object.freeze({
  kind: "Match.URL",
  parse(value: unknown): string {
    return parsePatternValue(value, matchUrlToken);
  },
  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(matchUrlToken, options);
  },
});
export const matchIsoDateStringToken = Object.freeze({
  kind: "Match.IsoDateString",
  parse(value: unknown): string {
    return parsePatternValue(value, matchIsoDateStringToken);
  },
  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(matchIsoDateStringToken, options);
  },
});
export class MaybePattern<TPattern = unknown> {
  public readonly kind = "Match.MaybePattern";
  constructor(public readonly pattern: TPattern) {}
  parse(value: unknown): InferMatchPattern<TPattern> | null | undefined {
    return parsePatternValue(value, this as MaybePattern<TPattern>) as
      | InferMatchPattern<TPattern>
      | null
      | undefined;
  }
  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(this as MaybePattern<TPattern>, options);
  }
}
export class OptionalPattern<TPattern = unknown> {
  public readonly kind = "Match.OptionalPattern";
  constructor(public readonly pattern: TPattern) {}
  parse(value: unknown): InferMatchPattern<TPattern> | undefined {
    return parsePatternValue(value, this as OptionalPattern<TPattern>) as
      | InferMatchPattern<TPattern>
      | undefined;
  }
  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(this as OptionalPattern<TPattern>, options);
  }
}
export class OneOfPattern<TPatterns extends readonly unknown[] = readonly []> {
  public readonly kind = "Match.OneOfPattern";
  constructor(public readonly patterns: TPatterns) {}
  parse(value: unknown): InferMatchPattern<TPatterns[number]> {
    return parsePatternValue(
      value,
      this as OneOfPattern<TPatterns>,
    ) as InferMatchPattern<TPatterns[number]>;
  }
  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(this as OneOfPattern<TPatterns>, options);
  }
}
export class WherePattern<TGuarded = unknown> {
  public readonly kind = "Match.WherePattern";
  constructor(public readonly condition: WhereCondition<TGuarded>) {}
  parse(value: unknown): TGuarded {
    return parsePatternValue(value, this as WherePattern<TGuarded>) as TGuarded;
  }
  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(this as WherePattern<TGuarded>, options);
  }
}
export class RegExpPattern<TExpression extends RegExp = RegExp> {
  public readonly kind = "Match.RegExpPattern";
  public readonly expression: TExpression;

  constructor(expression: TExpression) {
    this.expression = new RegExp(
      expression.source,
      expression.flags,
    ) as TExpression;
  }

  parse(value: unknown): string {
    return parsePatternValue(value, this as RegExpPattern<TExpression>) as string;
  }

  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(this as RegExpPattern<TExpression>, options);
  }
}
export class ObjectIncludingPattern<
  TObjectPattern extends Record<string, unknown> = Record<string, unknown>,
> {
  public readonly kind = "Match.ObjectIncludingPattern";
  constructor(public readonly pattern: TObjectPattern) {}
  parse(
    value: unknown,
  ): InferMatchPattern<TObjectPattern> & Record<string, unknown> {
    return parsePatternValue(
      value,
      this as ObjectIncludingPattern<TObjectPattern>,
    ) as InferMatchPattern<TObjectPattern> & Record<string, unknown>;
  }
  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(
      this as ObjectIncludingPattern<TObjectPattern>,
      options,
    );
  }
}
export class NonEmptyArrayPattern<TPattern = undefined> {
  public readonly kind = "Match.NonEmptyArrayPattern";
  constructor(public readonly pattern?: TPattern) {}
  parse(
    value: unknown,
  ): [NonEmptyArrayElement<TPattern>, ...NonEmptyArrayElement<TPattern>[]] {
    return parsePatternValue(value, this as NonEmptyArrayPattern<TPattern>) as [
      NonEmptyArrayElement<TPattern>,
      ...NonEmptyArrayElement<TPattern>[],
    ];
  }
  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(this as NonEmptyArrayPattern<TPattern>, options);
  }
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "Date";
  const valueType = typeof value;
  if (valueType !== "object") return valueType;
  const constructorName = (value as { constructor?: { name?: unknown } })
    .constructor?.name;
  return typeof constructorName === "string" && constructorName.length > 0
    ? constructorName
    : "object";
}

function formatPath(path: readonly PathSegment[]): string {
  if (path.length === 0) return "$";
  let current = "$";
  for (const segment of path) {
    if (typeof segment === "number") {
      current += `[${segment}]`;
      continue;
    }
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
      current += `.${segment}`;
      continue;
    }
    current += `[${JSON.stringify(segment)}]`;
  }
  return current;
}

function createFailure(
  path: readonly PathSegment[],
  expected: string,
  value: unknown,
  message?: string,
): MatchFailure {
  const renderedPath = formatPath(path);
  const actualType = describeType(value);
  return {
    path: renderedPath,
    expected,
    actualType,
    message:
      message ?? `Expected ${expected}, got ${actualType} at ${renderedPath}.`,
  };
}

function fail(
  context: MatchContext,
  path: readonly PathSegment[],
  expected: string,
  value: unknown,
  message?: string,
): false {
  context.failures.push(createFailure(path, expected, value, message));
  return false;
}

function appendPath(
  path: readonly PathSegment[],
  segment: PathSegment,
): PathSegment[] {
  return [...path, segment];
}

function matchesObjectPattern(
  value: unknown,
  pattern: Record<string, unknown>,
  context: MatchContext,
  path: readonly PathSegment[],
  allowUnknownKeys: boolean,
): boolean {
  if (!isPlainObject(value)) {
    return fail(context, path, "plain object", value);
  }
  const startFailures = context.failures.length;
  for (const key of Object.keys(value)) {
    if (key in pattern || allowUnknownKeys) continue;
    fail(
      context,
      appendPath(path, key),
      "known key",
      value[key],
      `Unknown key "${key}" found at ${formatPath(appendPath(path, key))}.`,
    );
    if (!context.collectAll) return false;
  }
  for (const [key, childPattern] of Object.entries(pattern)) {
    const hasOwnKey = Object.prototype.hasOwnProperty.call(value, key);
    if (!hasOwnKey) {
      if (childPattern instanceof OptionalPattern) {
        continue;
      }
      fail(
        context,
        appendPath(path, key),
        "defined value",
        undefined,
        `Missing required key "${key}" at ${formatPath(path)}.`,
      );
      if (!context.collectAll) return false;
      continue;
    }
    const matched = matchesPattern(
      value[key],
      childPattern,
      context,
      appendPath(path, key),
    );
    if (!matched && !context.collectAll) return false;
  }
  return context.failures.length === startFailures;
}

function matchesPattern(
  value: unknown,
  pattern: unknown,
  context: MatchContext,
  path: readonly PathSegment[],
): boolean {
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
    if (typeof value !== "string") {
      return fail(context, path, "url", value);
    }
    try {
      // URL constructor enforces URI syntax and supports multi-platform runtimes.

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
      : matchesPattern(value, pattern.pattern, context, path);
  }
  if (pattern instanceof MaybePattern) {
    return value === undefined || value === null
      ? true
      : matchesPattern(value, pattern.pattern, context, path);
  }
  if (pattern instanceof OneOfPattern) {
    for (const candidatePattern of pattern.patterns) {
      const candidateContext: MatchContext = { failures: [], collectAll: true };
      if (matchesPattern(value, candidatePattern, candidateContext, path)) {
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
  if (pattern instanceof WherePattern) {
    try {
      if (pattern.condition(value)) return true;
    } catch (error) {
      if (!(error instanceof MatchError)) throw error;
    }
    return fail(
      context,
      path,
      "Match.Where condition",
      value,
      `Failed Match.Where validation at ${formatPath(path)}.`,
    );
  }
  if (pattern instanceof RegExpPattern) {
    if (typeof value !== "string") {
      return fail(context, path, "string matching regular expression", value);
    }

    pattern.expression.lastIndex = 0;
    const matched = pattern.expression.test(value);
    pattern.expression.lastIndex = 0;

    return matched
      ? true
      : fail(context, path, "string matching regular expression", value);
  }
  if (pattern instanceof ObjectIncludingPattern) {
    return matchesObjectPattern(value, pattern.pattern, context, path, true);
  }
  if (pattern instanceof NonEmptyArrayPattern) {
    if (!Array.isArray(value) || value.length === 0) {
      return fail(context, path, "non-empty array", value);
    }
    if (pattern.pattern === undefined) return true;

    const startFailures = context.failures.length;
    for (let index = 0; index < value.length; index += 1) {
      const matched = matchesPattern(
        value[index],
        pattern.pattern,
        context,
        appendPath(path, index),
      );
      if (!matched && !context.collectAll) return false;
    }
    return context.failures.length === startFailures;
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
    return value !== null && typeof value === "object" && !Array.isArray(value)
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
      throw new MatchPatternError(
        "Bad pattern: arrays must have exactly one type element.",
      );
    }
    if (!Array.isArray(value)) return fail(context, path, "array", value);

    const startFailures = context.failures.length;
    for (let index = 0; index < value.length; index += 1) {
      const matched = matchesPattern(
        value[index],
        pattern[0],
        context,
        appendPath(path, index),
      );
      if (!matched && !context.collectAll) return false;
    }
    return context.failures.length === startFailures;
  }
  if (isPlainObject(pattern)) {
    return matchesObjectPattern(value, pattern, context, path, false);
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
      throw new MatchPatternError(
        `Bad pattern: constructor pattern "${pattern.name || "<anonymous>"}" is not valid.`,
      );
    }
  }
  throw new MatchPatternError(
    `Bad pattern: unsupported pattern type "${describeType(pattern)}".`,
  );
}

export function collectMatchFailures(
  value: unknown,
  pattern: unknown,
  collectAll: boolean,
): MatchFailure[] {
  const context: MatchContext = { failures: [], collectAll };
  const matches = matchesPattern(value, pattern, context, []);
  if (matches) return [];
  return collectAll ? context.failures : [context.failures[0]];
}

function parsePatternValue<TPattern>(
  value: unknown,
  pattern: TPattern,
): InferMatchPattern<TPattern> {
  const failures = collectMatchFailures(value, pattern, false);
  if (failures.length === 0) return value as InferMatchPattern<TPattern>;
  throw new MatchError(failures);
}
