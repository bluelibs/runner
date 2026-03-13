import { RunnerError, type MatchCompiledSchema } from "../..";
import { Match } from "../../decorators/legacy";
import { defineError } from "../../definers/defineError";
import {
  normalizeOptionalValidationSchema,
  normalizeValidationSchema,
} from "../../definers/normalizeValidationSchema";

class DecoratedSchema {
  value!: string;
}

Match.Schema()(DecoratedSchema);
Match.Field(String)(DecoratedSchema.prototype, "value");

class UndecoratedSchema {
  value!: string;
}

class StaticParseSchema {
  static parse(input: unknown): { value: string } {
    return { value: `static:${String(input)}` };
  }
}

describe("schema normalization helpers", () => {
  it("keeps parse schemas and supports undefined optional schemas", () => {
    const parse = jest.fn((input: unknown) => ({ value: String(input) }));
    const schema = { parse };

    const normalized = normalizeValidationSchema(schema, {
      definitionId: "tests-normalize-parse",
      subject: "Task input",
    });

    expect(normalized).toBe(schema);
    expect(normalized.parse(1)).toEqual({ value: "1" });
    expect(parse).toHaveBeenCalledWith(1);

    expect(
      normalizeOptionalValidationSchema(undefined, {
        definitionId: "tests-normalize-optional",
        subject: "Task input",
      }),
    ).toBeUndefined();
  });

  it("normalizes class and pattern schemas and rejects undecorated class shorthand", () => {
    const classSchema = normalizeValidationSchema(DecoratedSchema, {
      definitionId: "tests-normalize-class",
      subject: "Task input",
    });

    expect(classSchema.parse({ value: "ok" })).toEqual({ value: "ok" });
    expect(() => classSchema.parse({ value: 1 } as any)).toThrow();

    const objectSchema = normalizeValidationSchema(
      { value: String },
      {
        definitionId: "tests-normalize-object",
        subject: "Task input",
      },
    ) as MatchCompiledSchema<{ value: StringConstructor }>;

    expect(objectSchema.parse({ value: "ok" })).toEqual({ value: "ok" });
    expect(() => objectSchema.parse({ value: 1 } as any)).toThrow();
    expect(objectSchema.test({ value: "ok" })).toBe(true);
    expect(objectSchema.toJSONSchema()).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        value: { type: "string" },
      },
      required: ["value"],
      additionalProperties: false,
    });

    const functionSchema = normalizeValidationSchema(
      ((value: unknown) => typeof value === "string") as any,
      {
        definitionId: "tests-normalize-function",
        subject: "Task input",
      },
    );

    expect(typeof functionSchema.parse).toBe("function");

    expect(() =>
      normalizeValidationSchema(UndecoratedSchema as any, {
        definitionId: "tests-normalize-undecorated",
        subject: "Task input",
      }),
    ).toThrow(RunnerError);

    const nullPatternSchema = normalizeValidationSchema(null as any, {
      definitionId: "tests-normalize-null-pattern",
      subject: "Task input",
    });
    expect(nullPatternSchema.parse(null)).toBeNull();

    const parseKeyPatternSchema = normalizeValidationSchema(
      { parse: 1 } as any,
      {
        definitionId: "tests-normalize-parse-key-pattern",
        subject: "Task input",
      },
    );
    expect(parseKeyPatternSchema.parse({ parse: 1 })).toEqual({ parse: 1 });

    expect(() =>
      normalizeValidationSchema(
        class {
          value!: string;
        } as any,
        {
          definitionId: "tests-normalize-undecorated-anonymous",
          subject: "Task input",
        },
      ),
    ).toThrow("Anonymous");
  });

  it("reuses existing compiled Match schemas without recompiling", () => {
    const compiled = Match.compile({ value: String });

    const normalized = normalizeValidationSchema(compiled, {
      definitionId: "tests-normalize-compiled",
      subject: "Task input",
    });

    expect(normalized).toBe(compiled);
  });
});

describe("defineError schema normalization", () => {
  it("prefers parse-capable function schemas and validates pattern shorthand", () => {
    const staticParseError = defineError<{ value: string }>({
      id: "tests-error-schema-static-parse",
      dataSchema: StaticParseSchema as any,
      format: (data) => data.value,
    });

    expect(staticParseError.new("raw" as any).data).toEqual({
      value: "static:raw",
    });

    const patternError = defineError<{ value: string }>({
      id: "tests-error-schema-pattern",
      dataSchema: { value: String } as any,
      format: (data) => data.value,
    });

    expect(patternError.new({ value: "ok" }).data).toEqual({ value: "ok" });
    expect(() => patternError.new({ value: 1 } as any)).toThrow();
  });

  it("supports decorated classes and rejects undecorated class shorthand", () => {
    const decoratedError = defineError<{ value: string }>({
      id: "tests-error-schema-decorated",
      dataSchema: DecoratedSchema,
      format: (data) => data.value,
    });

    expect(decoratedError.new({ value: "ok" }).data).toEqual({ value: "ok" });
    expect(() => decoratedError.new({ value: 1 } as any)).toThrow();

    expect(() =>
      defineError<{ value: string }>({
        id: "tests-error-schema-undecorated",
        dataSchema: UndecoratedSchema as any,
        format: (data) => data.value,
      }),
    ).toThrow("@Match.Schema()");

    const trulyAnonymousClass = (0, eval)("(class { value; })");

    expect(() =>
      defineError<{ value: string }>({
        id: "tests-error-schema-undecorated-anonymous",
        dataSchema: trulyAnonymousClass as any,
        format: (data) => data.value,
      }),
    ).toThrow("Anonymous");
  });

  it("handles null and parse-key pattern fallbacks", () => {
    const nullSchemaError = defineError<any>({
      id: "tests-error-schema-null-pattern",
      dataSchema: null as any,
      format: () => "ok",
    });

    expect(nullSchemaError.id).toBe("tests-error-schema-null-pattern");

    const parseKeyPatternError = defineError<any>({
      id: "tests-error-schema-parse-key-pattern",
      dataSchema: { parse: 1 } as any,
      format: (data) => String(data.parse),
    });

    expect(parseKeyPatternError.new({ parse: 1 }).data).toEqual({ parse: 1 });

    const functionPatternError = defineError<any>({
      id: "tests-error-schema-function-pattern",
      dataSchema: ((value: unknown) => typeof value === "string") as any,
      format: () => "ok",
    });

    expect(functionPatternError.id).toBe("tests-error-schema-function-pattern");
  });
});
