import type { MatchJsonSchema } from "../types";
import type { MatchJsonSchemaCompiler } from "./contracts";
import {
  EMAIL_PATTERN,
  ISO_DATE_STRING_PATTERN,
  UUID_PATTERN,
  type MatchContext,
  type PathSegment,
} from "./shared";
import { fail } from "./utils";

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

type BuiltInValidator<TReturn> = (
  value: unknown,
  context: MatchContext,
  path: readonly PathSegment[],
) => value is TReturn;

export interface BuiltInMatcherDefinition<
  TKind extends string = string,
  TReturn = unknown,
> {
  readonly kind: TKind;
  readonly match: BuiltInValidator<TReturn>;
  readonly compileToJSONSchema: (
    context: Parameters<MatchJsonSchemaCompiler>[1],
    path: Parameters<MatchJsonSchemaCompiler>[2],
    mode: Parameters<MatchJsonSchemaCompiler>[3],
    compilePattern: MatchJsonSchemaCompiler,
  ) => MatchJsonSchema;
}

function createSimpleBuiltInMatcherDefinition<
  TKind extends string,
  TReturn = unknown,
>(
  kind: TKind,
  expected: string,
  matches: (value: unknown) => value is TReturn,
  toJSONSchema: () => MatchJsonSchema,
): BuiltInMatcherDefinition<TKind, TReturn> {
  return Object.freeze({
    kind,
    match(
      value: unknown,
      context: MatchContext,
      path: readonly PathSegment[],
    ): value is TReturn {
      return matches(value) ? true : fail(context, path, expected, value);
    },
    compileToJSONSchema: () => toJSONSchema(),
  });
}

function createBuiltInMatcherDefinition<
  TKind extends string,
  TReturn = unknown,
>(
  definition: BuiltInMatcherDefinition<TKind, TReturn>,
): BuiltInMatcherDefinition<TKind, TReturn> {
  return Object.freeze(definition);
}

export const builtInMatcherDefinitions = Object.freeze({
  Any: createBuiltInMatcherDefinition<"Match.Any", unknown>({
    kind: "Match.Any",
    match: (_value, _context, _path): _value is unknown => true,
    compileToJSONSchema: () => ({}),
  }),
  Integer: createSimpleBuiltInMatcherDefinition<"Match.Integer", number>(
    "Match.Integer",
    "32-bit integer",
    (value): value is number =>
      typeof value === "number" &&
      Number.isInteger(value) &&
      value <= INT32_MAX &&
      value >= INT32_MIN,
    () => ({
      type: "integer",
      minimum: INT32_MIN,
      maximum: INT32_MAX,
    }),
  ),
  PositiveInteger: createSimpleBuiltInMatcherDefinition<
    "Match.PositiveInteger",
    number
  >(
    "Match.PositiveInteger",
    "non-negative integer",
    (value): value is number =>
      typeof value === "number" && Number.isInteger(value) && value >= 0,
    () => ({
      type: "integer",
      minimum: 0,
    }),
  ),
  NonEmptyString: createSimpleBuiltInMatcherDefinition<
    "Match.NonEmptyString",
    string
  >(
    "Match.NonEmptyString",
    "non-empty string",
    (value): value is string => typeof value === "string" && value.length > 0,
    () => ({
      type: "string",
      minLength: 1,
    }),
  ),
  Email: createSimpleBuiltInMatcherDefinition<"Match.Email", string>(
    "Match.Email",
    "email",
    (value): value is string =>
      typeof value === "string" && EMAIL_PATTERN.test(value),
    () => ({
      type: "string",
      format: "email",
    }),
  ),
  UUID: createSimpleBuiltInMatcherDefinition<"Match.UUID", string>(
    "Match.UUID",
    "uuid",
    (value): value is string =>
      typeof value === "string" && UUID_PATTERN.test(value),
    () => ({
      type: "string",
      format: "uuid",
    }),
  ),
  URL: createBuiltInMatcherDefinition<"Match.URL", string>({
    kind: "Match.URL",
    match(value, context, path): value is string {
      if (typeof value !== "string") {
        return fail(context, path, "url", value);
      }

      try {
        new URL(value);
        return true;
      } catch {
        return fail(context, path, "url", value);
      }
    },
    compileToJSONSchema: () => ({
      type: "string",
      format: "uri",
    }),
  }),
  IsoDateString: createBuiltInMatcherDefinition<"Match.IsoDateString", string>({
    kind: "Match.IsoDateString",
    match(value, context, path): value is string {
      if (typeof value !== "string" || !ISO_DATE_STRING_PATTERN.test(value)) {
        return fail(context, path, "ISO date string", value);
      }

      return Number.isFinite(Date.parse(value))
        ? true
        : fail(context, path, "ISO date string", value);
    },
    compileToJSONSchema: () => ({
      type: "string",
      format: "date-time",
      pattern: ISO_DATE_STRING_PATTERN.source,
    }),
  }),
});

export type BuiltInMatcherDefinitions = typeof builtInMatcherDefinitions;
export type BuiltInMatcherDefinitionName = keyof BuiltInMatcherDefinitions;
export type BuiltInMatchKind =
  BuiltInMatcherDefinitions[BuiltInMatcherDefinitionName]["kind"];
