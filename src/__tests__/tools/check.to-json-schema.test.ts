import { CHECK_JSON_SCHEMA_UNSUPPORTED_PATTERN_ERROR_ID } from "../../tools/check";
import { checkJsonSchemaUnsupportedPatternError } from "../../errors";
import type { CheckJsonSchemaPatternRuntimeError } from "../../tools/check/errors";
import { Match } from "../../decorators/legacy";

const DRAFT_2020_12_SCHEMA = "https://json-schema.org/draft/2020-12/schema";
const builtInPublicTokens = Object.freeze({
  Integer: Match.Integer,
  PositiveInteger: Match.PositiveInteger,
  NonEmptyString: Match.NonEmptyString,
  Email: Match.Email,
  UUID: Match.UUID,
  URL: Match.URL,
  IsoDateString: Match.IsoDateString,
});
const builtInJsonSchemaExpectations = Object.freeze({
  Integer: {
    type: "integer",
    minimum: -2147483648,
    maximum: 2147483647,
  },
  PositiveInteger: {
    type: "integer",
    minimum: 0,
  },
  NonEmptyString: {
    type: "string",
    minLength: 1,
  },
  Email: {
    type: "string",
    format: "email",
  },
  UUID: {
    type: "string",
    format: "uuid",
  },
  URL: {
    type: "string",
    format: "uri",
  },
  IsoDateString: {
    type: "string",
    format: "date-time",
    pattern:
      "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?(?:Z|[+-]\\d{2}:\\d{2})$",
  },
});

function expectSchemaError(
  run: () => unknown,
): CheckJsonSchemaPatternRuntimeError {
  try {
    run();
    throw new Error("Expected checkJsonSchemaUnsupportedPatternError");
  } catch (error) {
    expect(checkJsonSchemaUnsupportedPatternError.is(error)).toBe(true);
    return error as CheckJsonSchemaPatternRuntimeError;
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
    expect(Match.toJSONSchema(Match.Range({ min: 1, max: 10 }))).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "number",
      minimum: 1,
      maximum: 10,
    });
    expect(
      Match.toJSONSchema(Match.Range({ min: 1, max: 10, integer: true })),
    ).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "integer",
      minimum: 1,
      maximum: 10,
    });
    expect(
      Match.toJSONSchema(Match.Range({ min: 1, max: 10, inclusive: false })),
    ).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "number",
      exclusiveMinimum: 1,
      exclusiveMaximum: 10,
    });
    expect(Match.toJSONSchema(Match.RegExp(/^[a-z]+$/))).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "string",
      pattern: "^[a-z]+$",
    });
  });

  it("converts Match.RegExp with flags without failing and annotates metadata", () => {
    expect(Match.toJSONSchema(Match.RegExp(/^[a-z]+$/i))).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "string",
      pattern: "^[a-z]+$",
      description:
        "Regex flags are not represented by JSON Schema pattern and are ignored during schema export.",
      "x-runner-match-kind": "Match.RegExp",
      "x-runner-regexp-flags": "i",
    });

    expect(
      Match.toJSONSchema(Match.RegExp(/^[a-z]+$/im), { strict: true }),
    ).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "string",
      pattern: "^[a-z]+$",
      description:
        "Regex flags are not represented by JSON Schema pattern and are ignored during schema export.",
      "x-runner-match-kind": "Match.RegExp",
      "x-runner-regexp-flags": "im",
    });
  });

  it("keeps built-in token JSON Schema exports stable", () => {
    for (const [name, expected] of Object.entries(
      builtInJsonSchemaExpectations,
    )) {
      expect(
        Match.toJSONSchema(
          builtInPublicTokens[name as keyof typeof builtInPublicTokens],
        ),
      ).toEqual({
        $schema: DRAFT_2020_12_SCHEMA,
        ...expected,
      });
    }
  });

  it("converts min-only and max-only Match.Range patterns", () => {
    expect(Match.toJSONSchema(Match.Range({ min: 1 }))).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "number",
      minimum: 1,
    });
    expect(
      Match.toJSONSchema(Match.Range({ max: 10, inclusive: false })),
    ).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "number",
      exclusiveMaximum: 10,
    });
    expect(Match.toJSONSchema(Match.Range({ min: 1, integer: true }))).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "integer",
      minimum: 1,
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
    expect(Match.toJSONSchema(Function)).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      description:
        "Function constructor patterns are not representable in strict JSON Schema and are exported as permissive nodes when strict is false.",
      "x-runner-match-kind": "Function",
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

  it("converts Match.ObjectStrict with additional properties disabled", () => {
    const schema = Match.toJSONSchema(
      Match.ObjectStrict({
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
      additionalProperties: false,
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

  it("represents Match.Where and Function using custom JSON Schema metadata by default", () => {
    expect(
      Match.toJSONSchema({
        profile: {
          custom: Match.Where((value: unknown) => typeof value === "string"),
          processor: Function,
        },
      }),
    ).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "object",
      properties: {
        profile: {
          type: "object",
          properties: {
            custom: {
              description:
                "Custom runtime predicate from Match.Where; not representable in strict JSON Schema.",
              "x-runner-match-kind": "Match.Where",
            },
            processor: {
              description:
                "Function constructor patterns are not representable in strict JSON Schema and are exported as permissive nodes when strict is false.",
              "x-runner-match-kind": "Function",
            },
          },
          required: ["custom", "processor"],
          additionalProperties: false,
        },
      },
      required: ["profile"],
      additionalProperties: false,
    });

    expect(Match.toJSONSchema(Match.MapOf(String))).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "object",
      additionalProperties: { type: "string" },
    });
  });

  it("exports Match.WithMessage using the wrapped inner pattern", () => {
    expect(
      Match.toJSONSchema({
        email: Match.WithMessage(Match.Email, "Invalid email"),
      }),
    ).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "object",
      properties: {
        email: {
          type: "string",
          format: "email",
        },
      },
      required: ["email"],
      additionalProperties: false,
    });
  });

  it("fails fast for unsupported patterns with path metadata in strict mode", () => {
    const whereError = expectSchemaError(() =>
      Match.toJSONSchema(
        {
          profile: {
            custom: Match.Where((value: unknown) => typeof value === "string"),
          },
        },
        { strict: true },
      ),
    );
    expect(whereError.id).toBe(CHECK_JSON_SCHEMA_UNSUPPORTED_PATTERN_ERROR_ID);
    expect(whereError.path).toBe("$.profile.custom");
    expect(whereError.reason).toContain("Match.Where");
    expect(whereError.patternKind).toBe("Match.Where");

    const functionError = expectSchemaError(() =>
      Match.toJSONSchema(
        {
          profile: {
            processor: Function,
          },
        },
        { strict: true },
      ),
    );
    expect(functionError.path).toBe("$.profile.processor");
    expect(functionError.reason).toContain("Function");
    expect(functionError.patternKind).toBe("Function");

    expect(Match.toJSONSchema(Match.MapOf(String), { strict: true })).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "object",
      additionalProperties: { type: "string" },
    });
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
    const functionError = expectSchemaError(() =>
      Match.toJSONSchema(Function, { strict: true }),
    );
    expect(functionError.path).toBe("$");
    expect(functionError.patternKind).toBe("Function");

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

    const invalidOneOf = Match.OneOf(String);
    Object.defineProperty(invalidOneOf, "patterns", {
      value: "invalid",
      configurable: true,
    });
    expect(Match.toJSONSchema(invalidOneOf as never)).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      anyOf: [],
    });

    const invalidObjectIncluding = Match.ObjectIncluding({
      value: String,
    });
    Object.defineProperty(invalidObjectIncluding, "pattern", {
      value: 123,
      configurable: true,
    });
    const objectIncludingError = expectSchemaError(() =>
      Match.toJSONSchema(invalidObjectIncluding as never),
    );
    expect(objectIncludingError.path).toBe("$");
    expect(objectIncludingError.reason).toContain("plain object pattern");

    const invalidObjectStrict = Match.ObjectStrict({
      value: String,
    });
    Object.defineProperty(invalidObjectStrict, "pattern", {
      value: 123,
      configurable: true,
    });
    const objectStrictError = expectSchemaError(() =>
      Match.toJSONSchema(invalidObjectStrict as never),
    );
    expect(objectStrictError.path).toBe("$");
    expect(objectStrictError.reason).toContain("plain object pattern");

    const invalidMapOf = Match.MapOf(String);
    Object.defineProperty(invalidMapOf, "pattern", {
      value: undefined,
      configurable: true,
    });
    expect(Match.toJSONSchema(invalidMapOf as never)).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      type: "object",
      additionalProperties: {},
    });

    const invalidRegExpPattern = Match.RegExp(/^value$/);
    Object.defineProperty(invalidRegExpPattern, "expression", {
      value: 123,
      configurable: true,
    });
    const regexpPatternError = expectSchemaError(() =>
      Match.toJSONSchema(invalidRegExpPattern as never),
    );
    expect(regexpPatternError.path).toBe("$");
    expect(regexpPatternError.reason).toContain("RegExp expression");
  });

  it("exports Match.fromSchema recursive schemas using $defs/$ref", () => {
    class User {
      public name!: string;
      public items!: Item[];
    }

    class Item {
      public title!: string;
      public owner!: User;
    }

    Match.Schema()(User);
    Match.Schema()(Item);
    Match.Field(Match.NonEmptyString)(User.prototype, "name");
    Match.Field(Match.ArrayOf(Match.fromSchema(Item)))(User.prototype, "items");
    Match.Field(Match.NonEmptyString)(Item.prototype, "title");
    Match.Field(Match.fromSchema(User))(Item.prototype, "owner");

    const schema = Match.toJSONSchema(Match.fromSchema(User));
    expect(schema).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      $ref: "#/$defs/User",
      $defs: {
        User: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1 },
            items: {
              type: "array",
              items: { $ref: "#/$defs/Item" },
            },
          },
          required: ["name", "items"],
          additionalProperties: true,
        },
        Item: {
          type: "object",
          properties: {
            title: { type: "string", minLength: 1 },
            owner: { $ref: "#/$defs/User" },
          },
          required: ["title", "owner"],
          additionalProperties: true,
        },
      },
    });
  });

  it("supports class schemaId collisions and exact override in JSON Schema export", () => {
    class UserA {
      public name!: string;
    }

    class UserB {
      public title!: string;
    }

    Match.Schema({ schemaId: "shared-id" })(UserA);
    Match.Schema({ schemaId: "shared-id", exact: true })(UserB);
    Match.Field(Match.NonEmptyString)(UserA.prototype, "name");
    Match.Field(Match.NonEmptyString)(UserB.prototype, "title");

    const schema = Match.toJSONSchema(
      Match.OneOf(
        Match.fromSchema(UserA),
        Match.fromSchema(UserB, { exact: false }),
      ),
    );

    expect(schema).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      anyOf: [{ $ref: "#/$defs/shared_id" }, { $ref: "#/$defs/shared_id_1" }],
      $defs: {
        shared_id: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1 },
          },
          required: ["name"],
          additionalProperties: true,
        },
        shared_id_1: {
          type: "object",
          properties: {
            title: { type: "string", minLength: 1 },
          },
          required: ["title"],
          additionalProperties: true,
        },
      },
    });

    class StrictUser {
      public id!: string;
    }

    Match.Schema()(StrictUser);
    Match.Field(Match.NonEmptyString)(StrictUser.prototype, "id");
    expect(
      Match.toJSONSchema(Match.fromSchema(StrictUser, { exact: true })),
    ).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      $ref: "#/$defs/StrictUser",
      $defs: {
        StrictUser: {
          type: "object",
          properties: {
            id: { type: "string", minLength: 1 },
          },
          required: ["id"],
          additionalProperties: false,
        },
      },
    });

    class AnonymousSchema {
      public value!: string;
    }

    Match.Schema({ schemaId: "!!!" })(AnonymousSchema);
    Match.Field(Match.NonEmptyString)(AnonymousSchema.prototype, "value");
    expect(Match.toJSONSchema(Match.fromSchema(AnonymousSchema))).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      $ref: "#/$defs/___",
      $defs: {
        ___: {
          type: "object",
          properties: {
            value: { type: "string", minLength: 1 },
          },
          required: ["value"],
          additionalProperties: true,
        },
      },
    });

    class EmptySchemaId {
      public token!: string;
    }

    Match.Schema()(EmptySchemaId);
    Match.Field(Match.NonEmptyString)(EmptySchemaId.prototype, "token");
    expect(
      Match.toJSONSchema(Match.fromSchema(EmptySchemaId, { schemaId: "" })),
    ).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      $ref: "#/$defs/Anonymous",
      $defs: {
        Anonymous: {
          type: "object",
          properties: {
            token: { type: "string", minLength: 1 },
          },
          required: ["token"],
          additionalProperties: true,
        },
      },
    });

    expect(
      Match.toJSONSchema(
        Match.OneOf(
          Match.fromSchema(EmptySchemaId),
          Match.fromSchema(EmptySchemaId),
        ),
      ),
    ).toEqual({
      $schema: DRAFT_2020_12_SCHEMA,
      anyOf: [
        { $ref: "#/$defs/EmptySchemaId" },
        { $ref: "#/$defs/EmptySchemaId" },
      ],
      $defs: {
        EmptySchemaId: {
          type: "object",
          properties: {
            token: { type: "string", minLength: 1 },
          },
          required: ["token"],
          additionalProperties: true,
        },
      },
    });
  });

  it("fails fast for invalid lazy and class pattern internals in toJSONSchema", () => {
    const invalidLazy = Match.Lazy(() => String);
    Object.defineProperty(invalidLazy, "resolve", {
      value: 123,
      configurable: true,
    });
    const lazyError = expectSchemaError(() =>
      Match.toJSONSchema(invalidLazy as never),
    );
    expect(lazyError.reason).toContain("resolver");

    class ValidClass {}
    const invalidClass = Match.fromSchema(ValidClass);
    Object.defineProperty(invalidClass, "options", {
      value: 123,
      configurable: true,
    });
    const classError = expectSchemaError(() =>
      Match.toJSONSchema(invalidClass as never),
    );
    expect(classError.reason).toContain("class constructor");

    const invalidClassCtor = Match.fromSchema(ValidClass);
    Object.defineProperty(invalidClassCtor, "ctor", {
      value: 123,
      configurable: true,
    });
    const classCtorError = expectSchemaError(() =>
      Match.toJSONSchema(invalidClassCtor as never),
    );
    expect(classCtorError.reason).toContain("class constructor");
  });
});
