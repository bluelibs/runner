import { matchToJsonSchema } from "../toJsonSchema";
import type { MatchJsonSchema, MatchToJsonSchemaOptions } from "../types";
import { parsePatternValue } from "./parse";

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ISO_DATE_STRING_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;

// Tokens are singleton sentinels; matcher core relies on identity checks.
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
