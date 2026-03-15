import { createMatchError } from "../errors";
import { matchToJsonSchema } from "../toJsonSchema";
import type { MatchJsonSchema, MatchToJsonSchemaOptions } from "../types";
import { collectMatchFailures, collectMatchResult } from "./core";
import type {
  MatchDefinedPattern,
  MatchJsonSchemaCompiler,
  MatchPatternMatcher,
} from "./contracts";
import {
  builtInMatcherDefinitions,
  type BuiltInMatchKind,
  type BuiltInMatcherDefinition,
  type BuiltInMatcherDefinitionName,
} from "./builtins";

// ── Factory: eliminates repeated parse/toJSONSchema boilerplate on tokens ────

type MatchToken<TKind extends string, TReturn = unknown> = Readonly<{
  kind: TKind;
  parse(value: unknown): TReturn;
  test(value: unknown): value is TReturn;
  match: MatchDefinedPattern["match"];
  compileToJSONSchema: MatchDefinedPattern["compileToJSONSchema"];
  appliesMessageOverrideToAggregate: MatchDefinedPattern["appliesMessageOverrideToAggregate"];
  isOptionalObjectProperty: MatchDefinedPattern["isOptionalObjectProperty"];
  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema;
}>;

function createMatchToken<TKind extends string, TReturn = unknown>(
  definition: BuiltInMatcherDefinition<TKind, TReturn>,
): MatchToken<TKind, TReturn> {
  return Object.freeze({
    kind: definition.kind,
    parse(value: unknown): TReturn {
      const { failures, messageOverride } = collectMatchResult(
        value,
        this,
        false,
      );
      if (failures.length === 0) return value as TReturn;
      throw createMatchError(failures, messageOverride);
    },
    test(value: unknown): value is TReturn {
      return collectMatchFailures(value, this, false).length === 0;
    },
    match(
      value: unknown,
      context: Parameters<MatchPatternMatcher>[2],
      path: Parameters<MatchPatternMatcher>[3],
      _parent: unknown,
      _matchesPattern: MatchPatternMatcher,
    ): value is TReturn {
      return definition.match(value, context, path);
    },
    compileToJSONSchema(
      context: Parameters<MatchJsonSchemaCompiler>[1],
      path: Parameters<MatchJsonSchemaCompiler>[2],
      mode: Parameters<MatchJsonSchemaCompiler>[3],
      compilePattern: MatchJsonSchemaCompiler,
    ): MatchJsonSchema {
      return definition.compileToJSONSchema(
        context,
        path,
        mode,
        compilePattern,
      );
    },
    appliesMessageOverrideToAggregate(): boolean {
      return false;
    },
    isOptionalObjectProperty(): boolean {
      return false;
    },
    toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
      return matchToJsonSchema(this, options);
    },
  });
}

type MatchTokens = {
  [TName in BuiltInMatcherDefinitionName]: MatchToken<
    (typeof builtInMatcherDefinitions)[TName]["kind"],
    (typeof builtInMatcherDefinitions)[TName] extends BuiltInMatcherDefinition<
      BuiltInMatchKind,
      infer TReturn
    >
      ? TReturn
      : never
  >;
};

function createBuiltInMatchTokens(): MatchTokens {
  const entries = Object.entries(builtInMatcherDefinitions).map(
    ([name, definition]) => {
      const token = createMatchToken(definition);
      return [name, token];
    },
  );

  return Object.freeze(Object.fromEntries(entries) as MatchTokens);
}

const builtInMatchTokens = createBuiltInMatchTokens();

// Tokens are singleton sentinels; matcher core relies on identity checks.
export const matchAnyToken = builtInMatchTokens.Any;
export const matchIntegerToken = builtInMatchTokens.Integer;
export const matchPositiveIntegerToken = builtInMatchTokens.PositiveInteger;
export const matchNonEmptyStringToken = builtInMatchTokens.NonEmptyString;
export const matchEmailToken = builtInMatchTokens.Email;
export const matchUuidToken = builtInMatchTokens.UUID;
export const matchUrlToken = builtInMatchTokens.URL;
export const matchIsoDateStringToken = builtInMatchTokens.IsoDateString;
