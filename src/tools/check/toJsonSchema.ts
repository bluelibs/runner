import {
  appendIndex,
  appendKey,
  type CompileContext,
  type CompileMode,
  isPlainObject,
  throwUnsupported,
  withCycleGuard,
} from "./toJsonSchema.helpers";
import { getClassSchemaDefinition } from "./classSchema";
import type { MatchJsonSchema, MatchToJsonSchemaOptions } from "./types";
import {
  ISO_DATE_STRING_PATTERN,
  resolveClassAllowUnknownKeys,
} from "./matcher/shared";

const JSON_SCHEMA_DRAFT_2020_12 =
  "https://json-schema.org/draft/2020-12/schema";
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

const MATCH_KIND = {
  Any: "Match.Any",
  Integer: "Match.Integer",
  PositiveInteger: "Match.PositiveInteger",
  NonEmptyString: "Match.NonEmptyString",
  Email: "Match.Email",
  UUID: "Match.UUID",
  URL: "Match.URL",
  IsoDateString: "Match.IsoDateString",
  OptionalPattern: "Match.OptionalPattern",
  MaybePattern: "Match.MaybePattern",
  OneOfPattern: "Match.OneOfPattern",
  WherePattern: "Match.WherePattern",
  LazyPattern: "Match.LazyPattern",
  RegExpPattern: "Match.RegExpPattern",
  ClassPattern: "Match.ClassPattern",
  ObjectIncludingPattern: "Match.ObjectIncludingPattern",
  ObjectStrictPattern: "Match.ObjectStrictPattern",
  NonEmptyArrayPattern: "Match.NonEmptyArrayPattern",
  MapOfPattern: "Match.MapOfPattern",
} as const;

type MatchKindValue = (typeof MATCH_KIND)[keyof typeof MATCH_KIND];
type KindPatternRecord = {
  kind: MatchKindValue;
  parse: (input: unknown) => unknown;
};

function isKindPattern(
  value: unknown,
  kind: MatchKindValue,
): value is KindPatternRecord {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { kind?: unknown; parse?: unknown };
  return candidate.kind === kind && typeof candidate.parse === "function";
}

function readPatternField(pattern: unknown): unknown {
  return (pattern as { pattern?: unknown }).pattern;
}

function readPatternsField(pattern: unknown): readonly unknown[] {
  const patterns = (pattern as { patterns?: unknown }).patterns;
  return Array.isArray(patterns) ? patterns : [];
}

function readRegExpExpressionField(pattern: unknown): RegExp | undefined {
  const expression = (pattern as { expression?: unknown }).expression;
  return expression instanceof RegExp ? expression : undefined;
}

function readClassField(pattern: unknown):
  | {
      ctor: abstract new (...args: never[]) => unknown;
      options?: { exact?: boolean; schemaId?: string };
    }
  | undefined {
  const candidate = pattern as {
    ctor?: unknown;
    options?: unknown;
  };

  if (typeof candidate.ctor !== "function") return undefined;
  if (candidate.options !== undefined && !isPlainObject(candidate.options)) {
    return undefined;
  }

  return {
    ctor: candidate.ctor as abstract new (...args: never[]) => unknown,
    options: candidate.options as
      | { exact?: boolean; schemaId?: string }
      | undefined,
  };
}

function readLazyResolverField(pattern: unknown): (() => unknown) | undefined {
  const candidate = pattern as { resolve?: unknown };
  if (typeof candidate.resolve !== "function") return undefined;
  const resolver = candidate.resolve as () => unknown;
  return () => resolver.call(candidate);
}

function sanitizeDefinitionId(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_$]/g, "_");
  return cleaned.length > 0 ? cleaned : "Anonymous";
}

function getDefinitionId(
  context: CompileContext,
  ctor: abstract new (...args: never[]) => unknown,
  preferredId: string,
): string {
  const existing = context.classDefinitionIds.get(ctor as unknown as Function);
  if (existing) return existing;

  const baseId = sanitizeDefinitionId(preferredId);
  let candidateId = baseId;

  while (context.definitions[candidateId]) {
    context.definitionCounter += 1;
    candidateId = `${baseId}_${context.definitionCounter}`;
  }

  context.classDefinitionIds.set(ctor as unknown as Function, candidateId);
  return candidateId;
}

function compileObjectPattern(
  pattern: Record<string, unknown>,
  context: CompileContext,
  path: string,
  allowUnknownKeys: boolean,
): MatchJsonSchema {
  const properties: Record<string, MatchJsonSchema> = {};
  const required: string[] = [];

  for (const [key, childPattern] of Object.entries(pattern)) {
    const childPath = appendKey(path, key);
    const isOptionalWrapper =
      isKindPattern(childPattern, MATCH_KIND.OptionalPattern) ||
      isKindPattern(childPattern, MATCH_KIND.MaybePattern);
    const compiledChild = compilePattern(
      childPattern,
      context,
      childPath,
      "object-property",
    );

    properties[key] = compiledChild;
    if (!isOptionalWrapper) {
      required.push(key);
    }
  }

  const schema: MatchJsonSchema = {
    type: "object",
    properties,
    additionalProperties: allowUnknownKeys,
  };
  if (required.length > 0) {
    schema.required = required;
  }
  return schema;
}

function compilePattern(
  pattern: unknown,
  context: CompileContext,
  path: string,
  mode: CompileMode,
): MatchJsonSchema {
  if (isKindPattern(pattern, MATCH_KIND.Any)) return {};
  if (isKindPattern(pattern, MATCH_KIND.Integer)) {
    return {
      type: "integer",
      minimum: INT32_MIN,
      maximum: INT32_MAX,
    };
  }
  if (isKindPattern(pattern, MATCH_KIND.PositiveInteger)) {
    return {
      type: "integer",
      minimum: 0,
    };
  }
  if (isKindPattern(pattern, MATCH_KIND.NonEmptyString)) {
    return { type: "string", minLength: 1 };
  }
  if (isKindPattern(pattern, MATCH_KIND.Email)) {
    return { type: "string", format: "email" };
  }
  if (isKindPattern(pattern, MATCH_KIND.UUID)) {
    return { type: "string", format: "uuid" };
  }
  if (isKindPattern(pattern, MATCH_KIND.URL)) {
    return { type: "string", format: "uri" };
  }
  if (isKindPattern(pattern, MATCH_KIND.IsoDateString)) {
    return {
      type: "string",
      format: "date-time",
      pattern: ISO_DATE_STRING_PATTERN.source,
    };
  }
  if (isKindPattern(pattern, MATCH_KIND.OptionalPattern)) {
    if (mode !== "object-property") {
      throwUnsupported(
        path,
        "Match.Optional can only be converted when used as an object property pattern.",
        pattern,
      );
    }
    return withCycleGuard(pattern, context, path, () =>
      compilePattern(readPatternField(pattern), context, path, "default"),
    );
  }
  if (isKindPattern(pattern, MATCH_KIND.MaybePattern)) {
    if (mode !== "object-property") {
      throwUnsupported(
        path,
        "Match.Maybe can only be converted when used as an object property pattern.",
        pattern,
      );
    }
    return withCycleGuard(pattern, context, path, () => ({
      anyOf: [
        compilePattern(readPatternField(pattern), context, path, "default"),
        { type: "null" },
      ],
    }));
  }
  if (isKindPattern(pattern, MATCH_KIND.OneOfPattern)) {
    return withCycleGuard(pattern, context, path, () => {
      const anyOf: MatchJsonSchema[] = [];
      const patterns = readPatternsField(pattern);
      for (let index = 0; index < patterns.length; index += 1) {
        anyOf.push(
          compilePattern(
            patterns[index],
            context,
            appendIndex(path, index),
            "default",
          ),
        );
      }
      return { anyOf };
    });
  }
  if (isKindPattern(pattern, MATCH_KIND.WherePattern)) {
    if (!context.strict) {
      return {
        description:
          "Custom runtime predicate from Match.Where; not representable in strict JSON Schema.",
        "x-runner-match-kind": "Match.Where",
      };
    }
    throwUnsupported(
      path,
      "Match.Where relies on runtime predicates and cannot be represented in strict JSON Schema.",
      pattern,
    );
  }
  if (isKindPattern(pattern, MATCH_KIND.LazyPattern)) {
    const resolver = readLazyResolverField(pattern);
    if (!resolver) {
      throwUnsupported(
        path,
        "Match.Lazy requires a resolver function.",
        pattern,
      );
    }

    return withCycleGuard(pattern, context, path, () =>
      compilePattern(resolver(), context, path, mode),
    );
  }
  if (isKindPattern(pattern, MATCH_KIND.RegExpPattern)) {
    const expression = readRegExpExpressionField(pattern);
    if (!expression) {
      throwUnsupported(
        path,
        "Match.RegExp requires a RegExp expression instance.",
        pattern,
      );
    }

    const schema: MatchJsonSchema = {
      type: "string",
      pattern: expression.source,
    };

    if (expression.flags.length > 0) {
      schema.description =
        "Regex flags are not represented by JSON Schema pattern and are ignored during schema export.";
      schema["x-runner-match-kind"] = "Match.RegExp";
      schema["x-runner-regexp-flags"] = expression.flags;
    }

    return schema;
  }
  if (isKindPattern(pattern, MATCH_KIND.ClassPattern)) {
    const classField = readClassField(pattern);
    if (!classField) {
      throwUnsupported(
        path,
        "Match.fromClass requires a class constructor.",
        pattern,
      );
    }

    const classDefinition = getClassSchemaDefinition(classField.ctor);
    const definitionId = getDefinitionId(
      context,
      classField.ctor,
      classField.options?.schemaId ?? classDefinition.schemaId,
    );

    if (!context.definitions[definitionId]) {
      if (context.compilingDefinitionIds.has(definitionId)) {
        return { $ref: `#/$defs/${definitionId}` };
      }

      context.compilingDefinitionIds.add(definitionId);
      try {
        const allowUnknownKeys = resolveClassAllowUnknownKeys(
          classField.options?.exact,
          classDefinition.exact,
        );

        context.definitions[definitionId] = compileObjectPattern(
          classDefinition.pattern,
          context,
          path,
          allowUnknownKeys,
        );
      } finally {
        context.compilingDefinitionIds.delete(definitionId);
      }
    }

    return { $ref: `#/$defs/${definitionId}` };
  }
  if (isKindPattern(pattern, MATCH_KIND.ObjectIncludingPattern)) {
    return withCycleGuard(pattern, context, path, () => {
      const innerPattern = readPatternField(pattern);
      if (!isPlainObject(innerPattern)) {
        throwUnsupported(
          path,
          "Match.ObjectIncluding requires a plain object pattern.",
          pattern,
        );
      }
      return compileObjectPattern(innerPattern, context, path, true);
    });
  }
  if (isKindPattern(pattern, MATCH_KIND.ObjectStrictPattern)) {
    return withCycleGuard(pattern, context, path, () => {
      const innerPattern = readPatternField(pattern);
      if (!isPlainObject(innerPattern)) {
        throwUnsupported(
          path,
          "Match.ObjectStrict requires a plain object pattern.",
          pattern,
        );
      }
      return compileObjectPattern(innerPattern, context, path, false);
    });
  }
  if (isKindPattern(pattern, MATCH_KIND.NonEmptyArrayPattern)) {
    return withCycleGuard(pattern, context, path, () => {
      const schema: MatchJsonSchema = { type: "array", minItems: 1 };
      const elementPattern = readPatternField(pattern);
      if (elementPattern !== undefined) {
        schema.items = compilePattern(
          elementPattern,
          context,
          appendIndex(path, 0),
          "default",
        );
      }
      return schema;
    });
  }
  if (isKindPattern(pattern, MATCH_KIND.MapOfPattern)) {
    return withCycleGuard(pattern, context, path, () => {
      const valuePattern = readPatternField(pattern);
      const additionalProperties =
        valuePattern !== undefined
          ? compilePattern(
              valuePattern,
              context,
              appendKey(path, "[*]"),
              "default",
            )
          : {};
      return {
        type: "object",
        additionalProperties,
      };
    });
  }

  if (pattern === String) return { type: "string" };
  if (pattern === Number) return { type: "number" };
  if (pattern === Boolean) return { type: "boolean" };
  if (pattern === Object) return { type: "object" };
  if (pattern === Array) return { type: "array" };
  if (pattern === Function) {
    if (!context.strict) {
      return {
        description:
          "Function constructor patterns are not representable in strict JSON Schema and are exported as permissive nodes when strict is false.",
        "x-runner-match-kind": "Function",
      };
    }
    throwUnsupported(
      path,
      "Function constructor patterns are not representable in strict JSON Schema.",
      pattern,
    );
  }

  if (
    pattern === null ||
    typeof pattern === "string" ||
    typeof pattern === "number" ||
    typeof pattern === "boolean"
  ) {
    return { const: pattern };
  }
  if (pattern === undefined) {
    throwUnsupported(
      path,
      "Undefined literals are not representable in JSON Schema.",
      pattern,
    );
  }
  if (typeof pattern === "bigint") {
    throwUnsupported(
      path,
      "BigInt literals are not representable in JSON Schema.",
      pattern,
    );
  }
  if (typeof pattern === "symbol") {
    throwUnsupported(
      path,
      "Symbol literals are not representable in JSON Schema.",
      pattern,
    );
  }

  if (Array.isArray(pattern)) {
    return withCycleGuard(pattern, context, path, () => {
      if (pattern.length !== 1) {
        throwUnsupported(
          path,
          "Array patterns must contain exactly one element pattern.",
          pattern,
        );
      }
      return {
        type: "array",
        items: compilePattern(
          pattern[0],
          context,
          appendIndex(path, 0),
          "default",
        ),
      };
    });
  }

  if (isPlainObject(pattern)) {
    return withCycleGuard(pattern, context, path, () =>
      compileObjectPattern(pattern, context, path, false),
    );
  }

  if (typeof pattern === "function") {
    throwUnsupported(
      path,
      "Custom constructor patterns are not representable in strict JSON Schema.",
      pattern,
    );
  }

  throwUnsupported(
    path,
    "Unsupported pattern type for JSON Schema conversion.",
    pattern,
  );
}

export function matchToJsonSchema(
  pattern: unknown,
  options?: MatchToJsonSchemaOptions,
): MatchJsonSchema {
  const context: CompileContext = {
    activePatterns: new WeakSet<object>(),
    strict: options?.strict === true,
    definitions: {},
    classDefinitionIds: new WeakMap<Function, string>(),
    compilingDefinitionIds: new Set<string>(),
    definitionCounter: 0,
  };
  const compiled = compilePattern(pattern, context, "$", "default");
  const rootSchema: MatchJsonSchema = {
    $schema: JSON_SCHEMA_DRAFT_2020_12,
    ...compiled,
  };

  if (Object.keys(context.definitions).length > 0) {
    rootSchema.$defs = context.definitions;
  }

  return rootSchema;
}
