import {
  checkJsonSchemaUnsupportedPatternError,
  matchError,
} from "../../errors";
import { Match, type MatchJsonSchema, check } from "../../tools/check";

function expectMatchFailure(
  run: () => unknown,
): ReturnType<typeof matchError.new> {
  try {
    run();
    throw new Error("Expected matchError");
  } catch (error) {
    expect(matchError.is(error)).toBe(true);
    return error as ReturnType<typeof matchError.new>;
  }
}

function expectSchemaError(
  run: () => unknown,
): ReturnType<typeof checkJsonSchemaUnsupportedPatternError.new> {
  try {
    run();
    throw new Error("Expected checkJsonSchemaUnsupportedPatternError");
  } catch (error) {
    expect(checkJsonSchemaUnsupportedPatternError.is(error)).toBe(true);
    return error as ReturnType<
      typeof checkJsonSchemaUnsupportedPatternError.new
    >;
  }
}

describe("tools/check schema support", () => {
  it("allows Match tokens to behave as schemas via parse()", () => {
    expect(Match.Any.parse({ any: "value" })).toEqual({ any: "value" });
    expect(Match.Integer.parse(10)).toBe(10);
    expect(Match.PositiveInteger.parse(0)).toBe(0);
    expect(Match.PositiveInteger.parse(10)).toBe(10);
    expect(Match.NonEmptyString.parse("ok")).toBe("ok");
    expect(Match.Email.parse("dev@example.com")).toBe("dev@example.com");
    expect(Match.UUID.parse("123e4567-e89b-42d3-a456-426614174000")).toBe(
      "123e4567-e89b-42d3-a456-426614174000",
    );
    expect(Match.URL.parse("https://example.com")).toBe("https://example.com");
    expect(Match.IsoDateString.parse("2026-01-01T10:20:30Z")).toBe(
      "2026-01-01T10:20:30Z",
    );
    expectMatchFailure(() => Match.Integer.parse(1.1));
    expectMatchFailure(() => Match.PositiveInteger.parse(-1));
    expectMatchFailure(() => Match.PositiveInteger.parse(1.1));
    expectMatchFailure(() => Match.NonEmptyString.parse(""));
    expectMatchFailure(() => Match.Email.parse("not-an-email"));
    expectMatchFailure(() => Match.UUID.parse("not-a-uuid"));
    expectMatchFailure(() => Match.URL.parse("not a url"));
    expectMatchFailure(() => Match.IsoDateString.parse("2026-01-01"));
  });

  it("allows Match patterns to behave as schemas via parse()", () => {
    const schema = Match.ObjectStrict({
      id: Match.NonEmptyString,
      retries: Match.Optional(Match.Integer),
    });

    expect(schema.parse({ id: "u1", retries: 1 })).toEqual({
      id: "u1",
      retries: 1,
    });
    expectMatchFailure(() => schema.parse({ id: "", retries: 1 }));
  });

  it("supports parse() on Optional/Maybe/OneOf/Where patterns", () => {
    expect(Match.Optional(String).parse(undefined)).toBeUndefined();
    expect(Match.Optional(String).parse("ok")).toBe("ok");

    expect(Match.Maybe(String).parse(undefined)).toBeUndefined();
    expect(Match.Maybe(String).parse(null)).toBeNull();
    expect(Match.Maybe(String).parse("ok")).toBe("ok");

    expect(Match.OneOf(String, Number).parse("ok")).toBe("ok");
    expect(Match.OneOf(String, Number).parse(10)).toBe(10);
    expectMatchFailure(() => Match.OneOf(String, Number).parse(false));

    const positiveNumber = Match.Where(
      (value: unknown): value is number =>
        typeof value === "number" && value > 0,
    );
    expect(positiveNumber.parse(1)).toBe(1);
    expectMatchFailure(() => positiveNumber.parse(0));

    expect(Match.NonEmptyArray().parse([1])).toEqual([1]);
    expect(Match.NonEmptyArray(String).parse(["a"])).toEqual(["a"]);
    expectMatchFailure(() => Match.NonEmptyArray().parse([]));
    expectMatchFailure(() => Match.NonEmptyArray(String).parse([1]));

    expect(check([1, 2], Match.ArrayOf(Number))).toEqual([1, 2]);
    expectMatchFailure(() => check(["1"] as never, Match.ArrayOf(Number)));

    const map = check(
      {
        worker: { id: "lane-worker" },
      },
      Match.MapOf(
        Match.ObjectIncluding({
          id: String,
        }),
      ),
    );
    expect(map.worker.id).toBe("lane-worker");
    expect(
      Match.MapOf(
        Match.ObjectIncluding({
          id: String,
        }),
      ).parse({
        worker: { id: "lane-worker" },
      }).worker.id,
    ).toBe("lane-worker");
    expectMatchFailure(() =>
      check({ worker: { id: 123 } }, Match.MapOf({ id: String })),
    );

    expect(Match.RegExp(/^ok$/).parse("ok")).toBe("ok");
    expectMatchFailure(() => Match.RegExp(/^ok$/).parse("nope"));
  });

  it("supports toJSONSchema() on Match schema-like tokens and wrappers", () => {
    expect(Match.Any.toJSONSchema()).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
    });
    expect(Match.Integer.toJSONSchema()).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "integer",
      minimum: -2147483648,
      maximum: 2147483647,
    });
    expect(Match.PositiveInteger.toJSONSchema()).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "integer",
      minimum: 0,
    });
    expect(Match.NonEmptyString.toJSONSchema()).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "string",
      minLength: 1,
    });
    expect(Match.Email.toJSONSchema()).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "string",
      format: "email",
    });
    expect(Match.UUID.toJSONSchema()).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "string",
      format: "uuid",
    });
    expect(Match.URL.toJSONSchema()).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "string",
      format: "uri",
    });
    expect(Match.IsoDateString.toJSONSchema()).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "string",
      format: "date-time",
      pattern:
        "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?(?:Z|[+-]\\d{2}:\\d{2})$",
    });

    expect(
      Match.ObjectIncluding({ id: Match.NonEmptyString }).toJSONSchema(),
    ).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        id: { type: "string", minLength: 1 },
      },
      required: ["id"],
      additionalProperties: true,
    });
    expect(
      Match.ObjectStrict({ id: Match.NonEmptyString }).toJSONSchema(),
    ).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        id: { type: "string", minLength: 1 },
      },
      required: ["id"],
      additionalProperties: false,
    });
    expect(Match.MapOf(String).toJSONSchema()).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: { type: "string" },
    });
    expect(Match.OneOf(String, Number).toJSONSchema()).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      anyOf: [{ type: "string" }, { type: "number" }],
    });
    expect(Match.NonEmptyArray(String).toJSONSchema()).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "array",
      minItems: 1,
      items: { type: "string" },
    });
    expect(Match.RegExp(/^runner$/).toJSONSchema()).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "string",
      pattern: "^runner$",
    });

    class UserSchema {
      public name!: string;
    }
    Match.Schema()(UserSchema);
    Match.Field(Match.NonEmptyString)(UserSchema.prototype, "name");

    expect(Match.fromSchema(UserSchema).parse({ name: "Ada" })).toEqual({
      name: "Ada",
    });

    expect(Match.fromSchema(UserSchema).toJSONSchema()).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $ref: "#/$defs/UserSchema",
      $defs: {
        UserSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              minLength: 1,
            },
          },
          required: ["name"],
          additionalProperties: true,
        },
      },
    });

    class RecursiveUserSchema {
      public name!: string;
      public self!: RecursiveUserSchema;
      public children!: RecursiveUserSchema[];
    }
    Match.Schema()(RecursiveUserSchema);
    Match.Field(Match.NonEmptyString)(RecursiveUserSchema.prototype, "name");
    Match.Field(Match.fromSchema(() => RecursiveUserSchema))(
      RecursiveUserSchema.prototype,
      "self",
    );
    Match.Field(Match.ArrayOf(Match.fromSchema(() => RecursiveUserSchema)))(
      RecursiveUserSchema.prototype,
      "children",
    );

    expect(Match.fromSchema(RecursiveUserSchema).toJSONSchema()).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $ref: "#/$defs/RecursiveUserSchema",
      $defs: {
        RecursiveUserSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              minLength: 1,
            },
            self: {
              $ref: "#/$defs/RecursiveUserSchema",
            },
            children: {
              type: "array",
              items: {
                $ref: "#/$defs/RecursiveUserSchema",
              },
            },
          },
          required: ["name", "self", "children"],
          additionalProperties: true,
        },
      },
    });
    expectSchemaError(() => Match.Optional(String).toJSONSchema());
    expectSchemaError(() => Match.Maybe(String).toJSONSchema());
    expect(Match.Where(() => true).toJSONSchema()).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      description:
        "Custom runtime predicate from Match.Where; not representable in strict JSON Schema.",
      "x-runner-match-kind": "Match.Where",
    });
    expectSchemaError(() =>
      Match.Where(() => true).toJSONSchema({ strict: true }),
    );
  });

  it("returns schema.parse output and supports transforms", () => {
    const schema = {
      parse: (value: unknown): { id: string } => {
        const raw = check(value, Match.ObjectIncluding({ id: String }));
        return { id: raw.id.trim() };
      },
    };

    const parsed = check({ id: "  user-1  " }, schema);
    expect(parsed).toEqual({ id: "user-1" });
  });

  it("supports Match.WithMessage as a schema wrapper", () => {
    const schema = Match.WithMessage(
      Match.NonEmptyString,
      ({ value, path }) =>
        `Expected non-empty string for ${path}, got ${String(value)}`,
    );

    expect(schema.parse("ok")).toBe("ok");
    expect(() => schema.parse("")).toThrow(
      "Expected non-empty string for $, got ",
    );
    expect(schema.toJSONSchema()).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "string",
      minLength: 1,
    });
  });

  it("rethrows errors thrown by schema.parse", () => {
    const plannedError = new Error("schema failed");
    const schema = {
      parse: (_value: unknown): never => {
        throw plannedError;
      },
    };

    expect(() => check("value", schema)).toThrow(plannedError);
  });

  it("accepts non-plain schema objects with parse()", () => {
    class NumberSchema {
      parse(value: unknown): number {
        return Number(value);
      }
    }

    expect(check("42", new NumberSchema())).toBe(42);
  });

  it("keeps pattern behavior for plain objects with parse plus extra keys", () => {
    const candidate = {
      parse: () => undefined,
      enabled: 123,
    };

    expectMatchFailure(() =>
      check(candidate, {
        parse: Function,
        enabled: Boolean,
      }),
    );
  });

  it("accepts options alongside schema-based checks", () => {
    const schema = {
      parse: (value: unknown): number => Number(value),
    };

    expect(check("41", schema, { errorPolicy: "all" })).toBe(41);
  });

  it("accepts plain schema objects with parse() and toJSONSchema()", () => {
    const schema = {
      parse: (value: unknown): { id: string } => ({ id: String(value) }),
      toJSONSchema: (): MatchJsonSchema => ({
        type: "object",
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
        additionalProperties: false,
      }),
    };

    expect(check(41, schema)).toEqual({ id: "41" });
  });

  it("rejects invalid toJSONSchema contracts on schema-like objects", () => {
    const candidate = {
      parse: (_value: unknown): { ok: true } => ({ ok: true }),
      toJSONSchema: 123,
    };

    expectMatchFailure(() => check("x", candidate as never));
  });

  it("supports a unified compiled schema shape from Match.compile()", () => {
    const pattern = {
      id: Match.NonEmptyString,
      retries: Match.Optional(Match.Integer),
    };
    const compiled = Match.compile(pattern);

    expect(compiled.pattern).toBe(pattern);
    expect(compiled.test({ id: "u1", retries: 1 })).toBe(true);
    expect(compiled.test({ id: "", retries: 1 })).toBe(false);
    expect(compiled.parse({ id: "u1", retries: 1 })).toEqual({
      id: "u1",
      retries: 1,
    });
    expectMatchFailure(() => compiled.parse({ id: "", retries: 1 }));
    expect(() => compiled.test("x")).not.toThrow();
    expect(check({ id: "u1" }, compiled)).toEqual({ id: "u1" });
    expect(compiled.toJSONSchema()).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        id: { type: "string", minLength: 1 },
        retries: {
          type: "integer",
          minimum: -2147483648,
          maximum: 2147483647,
        },
      },
      required: ["id"],
      additionalProperties: false,
    });
  });

  it("keeps Match.WithErrorPolicy wrappers transparent for toJSONSchema()", () => {
    const pattern = Match.WithErrorPolicy(
      {
        id: Match.NonEmptyString,
      },
      "all",
    );

    expect(Match.toJSONSchema(pattern)).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        id: { type: "string", minLength: 1 },
      },
      required: ["id"],
      additionalProperties: false,
    });
  });

  it("returns false when Match.Where throws inside compiled.test()", () => {
    const compiled = Match.compile(
      Match.Where(() => {
        throw new Error("boom");
      }),
    );

    expect(compiled.test("x")).toBe(false);
  });
});
