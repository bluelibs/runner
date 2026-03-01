import {
  CHECK_JSON_SCHEMA_UNSUPPORTED_PATTERN_ERROR_ID,
  CheckJsonSchemaPatternError,
  Match,
} from "../../tools/check";

const DRAFT_2020_12_SCHEMA = "https://json-schema.org/draft/2020-12/schema";

function expectSchemaError(run: () => unknown): CheckJsonSchemaPatternError {
  try {
    run();
    throw new Error("Expected CheckJsonSchemaPatternError");
  } catch (error) {
    expect(error).toBeInstanceOf(CheckJsonSchemaPatternError);
    return error as CheckJsonSchemaPatternError;
  }
}

describe("tools/check toJSONSchema", () => {
  it("adds the JSON Schema draft URI at root", () => {
    const schema = Match.toJSONSchema(Match.Any);
    expect(schema).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
    });
  });

  it("converts Match token patterns", () => {
    expect(Match.toJSONSchema(Match.Integer)).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "integer",
      minimum: -2147483648,
      maximum: 2147483647,
    });
    expect(Match.toJSONSchema(Match.PositiveInteger)).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "integer",
      minimum: 0,
    });
    expect(Match.toJSONSchema(Match.NonEmptyString)).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "string",
      minLength: 1,
    });
    expect(Match.toJSONSchema(Match.Email)).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "string",
      format: "email",
    });
    expect(Match.toJSONSchema(Match.UUID)).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "string",
      format: "uuid",
    });
    expect(Match.toJSONSchema(Match.URL)).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "string",
      format: "uri",
    });
    expect(Match.toJSONSchema(Match.IsoDateString)).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "string",
      format: "date-time",
      pattern:
        "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?(?:Z|[+-]\\d{2}:\\d{2})$",
    });
  });

  it("converts constructor and literal patterns", () => {
    expect(Match.toJSONSchema(String)).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "string",
    });
    expect(Match.toJSONSchema(Number)).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "number",
    });
    expect(Match.toJSONSchema(Boolean)).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "boolean",
    });
    expect(Match.toJSONSchema(Object)).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "object",
    });
    expect(Match.toJSONSchema(Array)).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "array",
    });
    expect(Match.toJSONSchema("ok")).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      const: "ok",
    });
    expect(Match.toJSONSchema(10)).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      const: 10,
    });
    expect(Match.toJSONSchema(true)).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      const: true,
    });
    expect(Match.toJSONSchema(null)).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      const: null,
    });
  });

  it("converts array patterns and non-empty arrays", () => {
    expect(Match.toJSONSchema([String])).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "array",
      items: { type: "string" },
    });
    expect(Match.toJSONSchema(Match.NonEmptyArray())).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "array",
      minItems: 1,
    });
    expect(Match.toJSONSchema(Match.NonEmptyArray(Number))).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "array",
      minItems: 1,
      items: { type: "number" },
    });
    expect(Match.toJSONSchema(Match.ArrayOf(String))).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "array",
      items: { type: "string" },
    });
  });

  it("converts strict object patterns and optional wrappers", () => {
    const schema = Match.toJSONSchema({
      id: Match.NonEmptyString,
      retries: Match.Optional(Match.Integer),
      note: Match.Maybe(String),
    });

    expect(schema).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "object",
      properties: {
        id: { type: "string", minLength: 1 },
        retries: {
          type: "integer",
          minimum: -2147483648,
          maximum: 2147483647,
        },
        note: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
      },
      required: ["id"],
      additionalProperties: false,
    });
  });

  it("converts Match.ObjectIncluding with additional properties allowed", () => {
    const schema = Match.toJSONSchema(
      Match.ObjectIncluding({
        id: String,
      }),
    );

    expect(schema).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
      additionalProperties: true,
    });
  });

  it("omits required when all object keys are optional wrappers", () => {
    const schema = Match.toJSONSchema({
      retries: Match.Optional(Match.Integer),
      note: Match.Maybe(String),
    });

    expect(schema).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "object",
      properties: {
        retries: {
          type: "integer",
          minimum: -2147483648,
          maximum: 2147483647,
        },
        note: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
      },
      additionalProperties: false,
    });
    expect(schema.required).toBeUndefined();
  });

  it("converts Match.OneOf as anyOf", () => {
    const schema = Match.toJSONSchema(
      Match.OneOf(String, [Number], Match.ObjectIncluding({ mode: "safe" })),
    );

    expect(schema).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      anyOf: [
        { type: "string" },
        { type: "array", items: { type: "number" } },
        {
          type: "object",
          properties: { mode: { const: "safe" } },
          required: ["mode"],
          additionalProperties: true,
        },
      ],
    });
  });

  it("fails fast for unsupported patterns with path metadata", () => {
    const whereError = expectSchemaError(() =>
      Match.toJSONSchema({
        profile: {
          custom: Match.Where((value: unknown) => typeof value === "string"),
        },
      }),
    );
    expect(whereError.id).toBe(CHECK_JSON_SCHEMA_UNSUPPORTED_PATTERN_ERROR_ID);
    expect(whereError.path).toBe("$.profile.custom");
    expect(whereError.reason).toContain("Match.Where");
    expect(whereError.patternKind).toBe("Match.Where");

    const recordOfError = expectSchemaError(() =>
      Match.toJSONSchema(Match.RecordOf(String)),
    );
    expect(recordOfError.path).toBe("$");
    expect(recordOfError.reason).toContain("Match.Where");
  });

  it("fails fast for Optional/Maybe outside object properties", () => {
    const optionalError = expectSchemaError(() =>
      Match.toJSONSchema(Match.Optional(String)),
    );
    expect(optionalError.path).toBe("$");
    expect(optionalError.patternKind).toBe("Match.Optional");

    const maybeError = expectSchemaError(() =>
      Match.toJSONSchema(Match.Maybe(String)),
    );
    expect(maybeError.path).toBe("$");
    expect(maybeError.patternKind).toBe("Match.Maybe");
  });

  it("fails fast for unsupported literals and constructor patterns", () => {
    expect(
      expectSchemaError(() => Match.toJSONSchema(undefined as never)).path,
    ).toBe("$");
    expect(expectSchemaError(() => Match.toJSONSchema(1n as never)).path).toBe(
      "$",
    );
    expect(
      expectSchemaError(() => Match.toJSONSchema(Symbol("x") as never)).path,
    ).toBe("$");
    expect(expectSchemaError(() => Match.toJSONSchema(Function)).path).toBe(
      "$",
    );

    class User {}
    const constructorError = expectSchemaError(() => Match.toJSONSchema(User));
    expect(constructorError.path).toBe("$");
  });

  it("fails fast for invalid array patterns and circular references", () => {
    const invalidArrayError = expectSchemaError(() =>
      Match.toJSONSchema([String, Number] as unknown as never),
    );
    expect(invalidArrayError.path).toBe("$");
    expect(invalidArrayError.patternKind).toBe("ArrayPattern");

    const circularPattern: Record<string, unknown> = {};
    circularPattern.self = circularPattern;
    const circularError = expectSchemaError(() =>
      Match.toJSONSchema(circularPattern as never),
    );
    expect(circularError.path).toBe("$.self");
    expect(circularError.reason).toContain("Circular");

    const unsupportedObjectError = expectSchemaError(() =>
      Match.toJSONSchema(/value/ as never),
    );
    expect(unsupportedObjectError.path).toBe("$");

    const invalidOneOf = {
      kind: "Match.OneOfPattern",
      parse: () => undefined,
      patterns: "invalid",
    };
    expect(Match.toJSONSchema(invalidOneOf as never)).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      anyOf: [],
    });

    const invalidObjectIncluding = {
      kind: "Match.ObjectIncludingPattern",
      parse: () => undefined,
      pattern: 123,
    };
    const objectIncludingError = expectSchemaError(() =>
      Match.toJSONSchema(invalidObjectIncluding as never),
    );
    expect(objectIncludingError.path).toBe("$");
    expect(objectIncludingError.reason).toContain("plain object pattern");
  });
});
