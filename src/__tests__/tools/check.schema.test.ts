import {
  CheckJsonSchemaPatternError,
  Match,
  MatchError,
  type MatchJsonSchema,
  check,
} from "../../tools/check";

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
    expect(() => Match.Integer.parse(1.1)).toThrow(MatchError);
    expect(() => Match.PositiveInteger.parse(-1)).toThrow(MatchError);
    expect(() => Match.PositiveInteger.parse(1.1)).toThrow(MatchError);
    expect(() => Match.NonEmptyString.parse("")).toThrow(MatchError);
    expect(() => Match.Email.parse("not-an-email")).toThrow(MatchError);
    expect(() => Match.UUID.parse("not-a-uuid")).toThrow(MatchError);
    expect(() => Match.URL.parse("not a url")).toThrow(MatchError);
    expect(() => Match.IsoDateString.parse("2026-01-01")).toThrow(MatchError);
  });

  it("allows Match patterns to behave as schemas via parse()", () => {
    const schema = Match.ObjectIncluding({
      id: Match.NonEmptyString,
      retries: Match.Optional(Match.Integer),
    });

    expect(schema.parse({ id: "u1", retries: 1 })).toEqual({
      id: "u1",
      retries: 1,
    });
    expect(() => schema.parse({ id: "", retries: 1 })).toThrow(MatchError);
  });

  it("supports parse() on Optional/Maybe/OneOf/Where patterns", () => {
    expect(Match.Optional(String).parse(undefined)).toBeUndefined();
    expect(Match.Optional(String).parse("ok")).toBe("ok");

    expect(Match.Maybe(String).parse(undefined)).toBeUndefined();
    expect(Match.Maybe(String).parse(null)).toBeNull();
    expect(Match.Maybe(String).parse("ok")).toBe("ok");

    expect(Match.OneOf(String, Number).parse("ok")).toBe("ok");
    expect(Match.OneOf(String, Number).parse(10)).toBe(10);
    expect(() => Match.OneOf(String, Number).parse(false)).toThrow(MatchError);

    const positiveNumber = Match.Where(
      (value: unknown): value is number =>
        typeof value === "number" && value > 0,
    );
    expect(positiveNumber.parse(1)).toBe(1);
    expect(() => positiveNumber.parse(0)).toThrow(MatchError);

    expect(Match.NonEmptyArray().parse([1])).toEqual([1]);
    expect(Match.NonEmptyArray(String).parse(["a"])).toEqual(["a"]);
    expect(() => Match.NonEmptyArray().parse([])).toThrow(MatchError);
    expect(() => Match.NonEmptyArray(String).parse([1])).toThrow(MatchError);

    expect(check([1, 2], Match.ArrayOf(Number))).toEqual([1, 2]);
    expect(() => check(["1"] as never, Match.ArrayOf(Number))).toThrow(
      MatchError,
    );

    const map = check(
      {
        worker: { id: "lane.worker" },
      },
      Match.RecordOf(
        Match.ObjectIncluding({
          id: String,
        }),
      ),
    );
    expect(map.worker.id).toBe("lane.worker");
    expect(() =>
      check({ worker: { id: 123 } }, Match.RecordOf({ id: String })),
    ).toThrow(MatchError);
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
    expect(() => Match.Optional(String).toJSONSchema()).toThrow(
      CheckJsonSchemaPatternError,
    );
    expect(() => Match.Maybe(String).toJSONSchema()).toThrow(
      CheckJsonSchemaPatternError,
    );
    expect(Match.Where(() => true).toJSONSchema()).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      description:
        "Custom runtime predicate from Match.Where; not representable in strict JSON Schema.",
      "x-runner-match-kind": "Match.Where",
    });
    expect(() => Match.Where(() => true).toJSONSchema({ strict: true })).toThrow(
      CheckJsonSchemaPatternError,
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

    expect(() =>
      check(candidate, {
        parse: Function,
        enabled: Boolean,
      }),
    ).toThrow(MatchError);
  });

  it("accepts options alongside schema-based checks", () => {
    const schema = {
      parse: (value: unknown): number => Number(value),
    };

    expect(check("41", schema, { throwAllErrors: true })).toBe(41);
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

    expect(() => check("x", candidate as never)).toThrow(MatchError);
  });

  it("supports a unified compiled schema shape from Match.compile()", () => {
    const pattern = {
      id: Match.NonEmptyString,
      retries: Match.Optional(Match.Integer),
    };
    const compiled = Match.compile(pattern);

    expect(compiled.pattern).toBe(pattern);
    expect(compiled.parse({ id: "u1", retries: 1 })).toEqual({
      id: "u1",
      retries: 1,
    });
    expect(() => compiled.parse({ id: "", retries: 1 })).toThrow(MatchError);
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
});
