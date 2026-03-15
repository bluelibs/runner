import { matchError } from "../../errors";
import { Match as LegacyMatch } from "../../decorators/legacy";
import { Match, check } from "../../tools/check";
import { isMatchClassPatternOptions } from "../../tools/check/matcher/definitions/helpers";
import { matchesPattern } from "../../tools/check/matcher/matching";
import { MatchPatternBase } from "../../tools/check/matcher/patterns";

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

describe("tools/check matcher coverage", () => {
  it("fails fast when a MatchPatternBase instance has no registered definition", () => {
    const orphanPattern = Object.create(
      MatchPatternBase.prototype,
    ) as MatchPatternBase<unknown>;

    expect(() => orphanPattern.appliesMessageOverrideToAggregate()).toThrow(
      "Bad pattern: missing Match definition.",
    );
    expect(() => orphanPattern.isOptionalObjectProperty()).toThrow(
      "Bad pattern: missing Match definition.",
    );
  });

  it("omits required when an object schema only contains optional Match properties", () => {
    expect(
      Match.toJSONSchema(
        Match.ObjectStrict({
          retries: Match.Optional(Match.Integer),
          note: Match.Maybe(String),
        }),
      ),
    ).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
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
  });

  it("covers defensive matcher branches for invalid mutated pattern internals", () => {
    const context = () => ({
      failures: [],
      collectAll: false,
      activeComparisons: new WeakMap<object, WeakSet<object>>(),
    });

    const invalidOneOf = Match.OneOf(String);
    Object.defineProperty(invalidOneOf, "patterns", {
      value: "invalid",
      configurable: true,
    });
    expectMatchFailure(() => check("runner", invalidOneOf as never));

    const invalidWhere = Match.Where(() => true);
    Object.defineProperty(invalidWhere, "condition", {
      value: "invalid",
      configurable: true,
    });
    expectMatchFailure(() => check("runner", invalidWhere as never));

    const invalidLazy = Match.Lazy(() => String);
    Object.defineProperty(invalidLazy, "resolve", {
      value: "invalid",
      configurable: true,
    });
    expect(
      invalidLazy.match("runner", context(), [], undefined, matchesPattern),
    ).toBe(false);

    class ValidSchema {}
    const invalidClass = Match.fromSchema(ValidSchema);
    Object.defineProperty(invalidClass, "ctor", {
      value: "invalid",
      configurable: true,
    });
    expect(() =>
      invalidClass.match({}, context(), [], undefined, matchesPattern),
    ).toThrow("Bad pattern: Match.fromSchema requires a class constructor.");

    class RuntimeSchema {
      public id!: string;
    }

    LegacyMatch.Schema()(RuntimeSchema);
    LegacyMatch.Field(Match.NonEmptyString)(RuntimeSchema.prototype, "id");

    const classWithInvalidRuntimeOptions = Match.fromSchema(RuntimeSchema);
    Object.defineProperty(classWithInvalidRuntimeOptions, "options", {
      value: "invalid",
      configurable: true,
    });
    expect(
      classWithInvalidRuntimeOptions.match(
        { id: "u1" },
        context(),
        [],
        undefined,
        matchesPattern,
      ),
    ).toBe(true);

    const invalidRegExp = Match.RegExp(/^ok$/);
    Object.defineProperty(invalidRegExp, "expression", {
      value: "invalid",
      configurable: true,
    });
    expect(() =>
      invalidRegExp.match("ok", context(), [], undefined, matchesPattern),
    ).toThrow(
      "Bad pattern: Match.RegExp requires a RegExp instance or source string.",
    );

    const invalidRange = Match.Range({ min: 1 });
    Object.defineProperty(invalidRange, "min", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(invalidRange, "max", {
      value: undefined,
      configurable: true,
    });
    expect(() =>
      invalidRange.match(1, context(), [], undefined, matchesPattern),
    ).toThrow("Bad pattern: Match.Range requires at least one of min or max.");
    expect(() => invalidRange.toJSONSchema()).toThrow(
      "Bad pattern: Match.Range requires at least one of min or max.",
    );
  });

  it("exposes wrapper metadata helpers directly on Match-native patterns", () => {
    expect(
      Match.WithMessage(String, "nope").appliesMessageOverrideToAggregate(),
    ).toBe(false);
    expect(
      Match.WithMessage(
        Match.ObjectIncluding({
          id: String,
        }),
        "nope",
      ).appliesMessageOverrideToAggregate(),
    ).toBe(true);
    expect(Match.Optional(String).isOptionalObjectProperty()).toBe(true);
    expect(Match.Where(() => true).isOptionalObjectProperty()).toBe(false);
  });

  it("validates class pattern options with explicit helper guards", () => {
    expect(isMatchClassPatternOptions(undefined)).toBe(true);
    expect(isMatchClassPatternOptions({ exact: true, schemaId: "User" })).toBe(
      true,
    );
    expect(isMatchClassPatternOptions({ exact: "yes" })).toBe(false);
    expect(isMatchClassPatternOptions({ schemaId: 123 })).toBe(false);
  });
});
