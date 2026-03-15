import type { MatchJsonSchema } from "../types";
import type { CompileContext, CompileMode } from "../toJsonSchema.helpers";
import type { MatchContext, PathSegment } from "./shared";
import { isPlainObject } from "./utils";

/**
 * Shared matcher dispatcher signature used by Match-defined patterns when they
 * delegate to nested child patterns.
 */
export type MatchPatternMatcher = (
  value: unknown,
  pattern: unknown,
  context: MatchContext,
  path: readonly PathSegment[],
  parent?: unknown,
) => boolean;

/**
 * Shared JSON-Schema compiler signature used by Match-defined patterns when
 * they delegate schema export to nested child patterns.
 */
export type MatchJsonSchemaCompiler = (
  pattern: unknown,
  context: CompileContext,
  path: string,
  mode: CompileMode,
) => MatchJsonSchema;

/**
 * Runtime contract implemented by every Match-native token and helper-created
 * pattern instance.
 */
export interface MatchDefinedPattern {
  readonly kind: string;
  match(
    value: unknown,
    context: MatchContext,
    path: readonly PathSegment[],
    parent: unknown,
    matchesPattern: MatchPatternMatcher,
  ): boolean;
  compileToJSONSchema(
    context: CompileContext,
    path: string,
    mode: CompileMode,
    compilePattern: MatchJsonSchemaCompiler,
  ): MatchJsonSchema;
  appliesMessageOverrideToAggregate(): boolean;
  isOptionalObjectProperty(): boolean;
}

/**
 * Internal definition contract used to keep a pattern family's runtime and
 * JSON-Schema behavior together in one place.
 */
export interface MatchPatternDefinition<TPattern extends object> {
  readonly kind: string;
  match(
    pattern: TPattern,
    value: unknown,
    context: MatchContext,
    path: readonly PathSegment[],
    parent: unknown,
    matchesPattern: MatchPatternMatcher,
  ): boolean;
  compileToJSONSchema(
    pattern: TPattern,
    context: CompileContext,
    path: string,
    mode: CompileMode,
    compilePattern: MatchJsonSchemaCompiler,
  ): MatchJsonSchema;
  appliesMessageOverrideToAggregate?(pattern: TPattern): boolean;
  isOptionalObjectProperty?(pattern: TPattern): boolean;
}

export function defineMatchPatternDefinition<TPattern extends object>(
  definition: MatchPatternDefinition<TPattern>,
): MatchPatternDefinition<TPattern> {
  return Object.freeze(definition);
}

export function isMatchDefinedPattern(
  value: unknown,
): value is MatchDefinedPattern {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<MatchDefinedPattern>;
  return (
    typeof candidate.kind === "string" &&
    typeof candidate.match === "function" &&
    typeof candidate.compileToJSONSchema === "function" &&
    typeof candidate.appliesMessageOverrideToAggregate === "function" &&
    typeof candidate.isOptionalObjectProperty === "function"
  );
}

export function isOptionalObjectPropertyPattern(pattern: unknown): boolean {
  return (
    isMatchDefinedPattern(pattern) && pattern.isOptionalObjectProperty()
  );
}

export function shouldPatternApplyMessageOverrideToAggregate(
  pattern: unknown,
): boolean {
  if (isMatchDefinedPattern(pattern)) {
    return pattern.appliesMessageOverrideToAggregate();
  }

  if (pattern === Object || pattern === Array) return true;
  if (Array.isArray(pattern)) return true;
  if (isPlainObject(pattern)) return true;

  return false;
}
