import {
  appendIndex,
  appendKey,
  type CompileContext,
  type CompileMode,
  isPlainObject,
  throwUnsupported,
  withCycleGuard,
} from "./toJsonSchema.helpers";
import type { MatchJsonSchema, MatchToJsonSchemaOptions } from "./types";
import {
  isMatchDefinedPattern,
  isOptionalObjectPropertyPattern,
} from "./matcher/contracts";

const JSON_SCHEMA_DRAFT_2020_12 =
  "https://json-schema.org/draft/2020-12/schema";

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
    properties[key] = compilePattern(
      childPattern,
      context,
      childPath,
      "object-property",
    );

    if (!isOptionalObjectPropertyPattern(childPattern)) {
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
  if (isMatchDefinedPattern(pattern)) {
    return pattern.compileToJSONSchema(context, path, mode, compilePattern);
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
