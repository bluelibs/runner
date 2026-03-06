import { MatchError } from "../errors";
import { matchToJsonSchema } from "../toJsonSchema";
import type { MatchJsonSchema, MatchToJsonSchemaOptions } from "../types";
import { collectMatchFailures } from "./core";

// ── Factory: eliminates repeated parse/toJSONSchema boilerplate on tokens ────

function createMatchToken<TKind extends string, TReturn = unknown>(
  kind: TKind,
) {
  return Object.freeze({
    kind,
    parse(value: unknown): TReturn {
      const failures = collectMatchFailures(value, this, false);
      if (failures.length === 0) return value as TReturn;
      throw new MatchError(failures);
    },
    toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
      return matchToJsonSchema(this, options);
    },
  });
}

// Tokens are singleton sentinels; matcher core relies on identity checks.
export const matchAnyToken = createMatchToken<"Match.Any", unknown>(
  "Match.Any",
);
export const matchIntegerToken = createMatchToken<"Match.Integer", number>(
  "Match.Integer",
);
export const matchPositiveIntegerToken = createMatchToken<
  "Match.PositiveInteger",
  number
>("Match.PositiveInteger");
export const matchNonEmptyStringToken = createMatchToken<
  "Match.NonEmptyString",
  string
>("Match.NonEmptyString");
export const matchEmailToken = createMatchToken<"Match.Email", string>(
  "Match.Email",
);
export const matchUuidToken = createMatchToken<"Match.UUID", string>(
  "Match.UUID",
);
export const matchUrlToken = createMatchToken<"Match.URL", string>("Match.URL");
export const matchIsoDateStringToken = createMatchToken<
  "Match.IsoDateString",
  string
>("Match.IsoDateString");
