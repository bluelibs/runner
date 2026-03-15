import { RunnerError } from "../../definers/defineError";
import {
  checkInvalidPatternError,
  matchError,
} from "../../errors/foundation/match.errors";
import { createMatchError } from "../../tools/check/errors";
import {
  CHECK_INVALID_PATTERN_ERROR_ID,
  MATCH_ERROR_ID,
  Match,
  check,
  isMatchError,
} from "../../tools/check";

const checkRuntime = check as (
  value: unknown,
  pattern: unknown,
  options?: { throwAllErrors?: boolean },
) => unknown;

class User {
  constructor(public readonly id: string) {}
}

function expectMatchFailure(
  run: () => unknown,
): ReturnType<typeof matchError.new> {
  try {
    run();
    throw new Error("Expected matchError");
  } catch (error) {
    expect(isMatchError(error)).toBe(true);
    return error as ReturnType<typeof matchError.new>;
  }
}

describe("tools/check", () => {
  it("returns the same validated value reference", () => {
    const input = { id: "u1" };
    const result = checkRuntime(input, { id: String });
    expect(result).toBe(input);
  });
  it("validates primitive constructor patterns", () => {
    expect(() => checkRuntime("x", String)).not.toThrow();
    expect(() => checkRuntime(1, Number)).not.toThrow();
    expect(() => checkRuntime(true, Boolean)).not.toThrow();
    expect(() => checkRuntime([], Array)).not.toThrow();
    expect(() => checkRuntime({}, Object)).not.toThrow();
    expect(() => checkRuntime(() => undefined, Function)).not.toThrow();

    expectMatchFailure(() => checkRuntime("x", Boolean));
    expectMatchFailure(() => checkRuntime("x", Function));
    expectMatchFailure(() => checkRuntime([], Object));
    expectMatchFailure(() => checkRuntime("x", Array));
  });

  it("supports literal patterns", () => {
    expect(() => checkRuntime("a", "a")).not.toThrow();
    expect(() => checkRuntime(10, 10)).not.toThrow();
    expect(() => checkRuntime(undefined, undefined)).not.toThrow();
    expect(() => checkRuntime(null, null)).not.toThrow();
    expect(() => checkRuntime(1n, 1n)).not.toThrow();

    const symbol = Symbol("check");
    expect(() => checkRuntime(symbol, symbol)).not.toThrow();
    expectMatchFailure(() => checkRuntime("b", "a"));
  });

  it("supports custom constructor patterns", () => {
    expect(() => checkRuntime(new User("u1"), User)).not.toThrow();
    expectMatchFailure(() => checkRuntime({ id: "u1" }, User));
  });

  it("matches Match.Any, Match.Integer and Match.NonEmptyString", () => {
    expect(() => checkRuntime({ anything: true }, Match.Any)).not.toThrow();
    expect(() => checkRuntime(12, Match.Integer)).not.toThrow();
    expect(() => checkRuntime("name", Match.NonEmptyString)).not.toThrow();

    expectMatchFailure(() => checkRuntime(1.2, Match.Integer));
    expectMatchFailure(() => checkRuntime(2147483648, Match.Integer));
    expectMatchFailure(() => checkRuntime("", Match.NonEmptyString));
  });

  it("keeps built-in matcher failure expectations stable", () => {
    const cases = [
      {
        pattern: Match.Integer,
        value: 1.2,
        expected: "32-bit integer",
      },
      {
        pattern: Match.NonEmptyString,
        value: "",
        expected: "non-empty string",
      },
      {
        pattern: Match.URL,
        value: "not a url",
        expected: "url",
      },
      {
        pattern: Match.IsoDateString,
        value: "2026-01-01",
        expected: "ISO date string",
      },
    ] as const;

    for (const testCase of cases) {
      const error = expectMatchFailure(() =>
        checkRuntime(testCase.value, testCase.pattern),
      );
      expect(error.data.failures[0]?.expected).toBe(testCase.expected);
    }
  });

  it("handles Maybe and Optional wrappers", () => {
    expect(() => checkRuntime(undefined, Match.Optional(String))).not.toThrow();
    expect(() => checkRuntime("ok", Match.Optional(String))).not.toThrow();
    expect(() => checkRuntime(undefined, Match.Maybe(String))).not.toThrow();
    expect(() => checkRuntime(null, Match.Maybe(String))).not.toThrow();
    expect(() => checkRuntime("ok", Match.Maybe(String))).not.toThrow();

    expectMatchFailure(() => checkRuntime(null, Match.Optional(String)));
    expectMatchFailure(() => checkRuntime(7, Match.Maybe(String)));
  });

  it("validates arrays using one-element array patterns", () => {
    expect(() => checkRuntime(["a", "b"], [String])).not.toThrow();
    expectMatchFailure(() => checkRuntime([1, "b"], [String]));
    expectMatchFailure(() => checkRuntime("not-array", [String]));
  });

  it("validates strict object patterns and produces paths", () => {
    const error = expectMatchFailure(() =>
      checkRuntime(
        { profile: { name: 10 } },
        {
          profile: {
            name: String,
          },
        },
      ),
    );
    expect(error.id).toBe(MATCH_ERROR_ID);
    expect(error.data.path).toBe("$.profile.name");
    expect(error.data.failures[0].path).toBe("$.profile.name");
  });

  it("formats non-identifier keys using bracket notation in failure paths", () => {
    const error = expectMatchFailure(() =>
      checkRuntime(
        {
          "full-name": 10,
        },
        {
          "full-name": String,
        },
      ),
    );
    expect(error.data.path).toBe('$["full-name"]');
  });

  it("requires plain objects for plain-object patterns", () => {
    expectMatchFailure(() => checkRuntime([], { id: String }));
  });

  it("rejects unknown object keys by default and allows them with ObjectIncluding", () => {
    expectMatchFailure(() =>
      checkRuntime(
        { id: "1", extra: true },
        {
          id: String,
        },
      ),
    );

    expect(() =>
      checkRuntime(
        { id: "1", extra: true },
        Match.ObjectIncluding({
          id: String,
        }),
      ),
    ).not.toThrow();
  });

  it("supports Match.ObjectStrict as explicit strict object shorthand", () => {
    expect(() =>
      checkRuntime(
        { id: "1" },
        Match.ObjectStrict({
          id: String,
        }),
      ),
    ).not.toThrow();

    expectMatchFailure(() =>
      checkRuntime(
        { id: "1", extra: true },
        Match.ObjectStrict({
          id: String,
        }),
      ),
    );
  });

  it("supports Match.MapOf for dynamic-key object values", () => {
    expect(() =>
      checkRuntime(
        {
          a: { id: "lane-a" },
          b: { id: "lane-b" },
        },
        Match.MapOf({
          id: String,
        }),
      ),
    ).not.toThrow();

    expectMatchFailure(() =>
      checkRuntime(
        {
          a: { id: 1 },
        },
        Match.MapOf({
          id: String,
        }),
      ),
    );
  });

  it("requires required object keys even when the pattern is Match.Any", () => {
    expectMatchFailure(() =>
      checkRuntime(
        {},
        Match.ObjectIncluding({
          value: Match.Any,
        }),
      ),
    );

    expect(() =>
      checkRuntime(
        { value: undefined },
        Match.ObjectIncluding({
          value: Match.Any,
        }),
      ),
    ).not.toThrow();

    expect(() =>
      checkRuntime(
        {},
        Match.ObjectIncluding({
          value: Match.Optional(Match.Any),
        }),
      ),
    ).not.toThrow();
  });

  it("validates nested object graphs with arrays and reports deep paths", () => {
    const pattern = Match.ObjectIncluding({
      topology: Match.ObjectIncluding({
        bindings: Match.ArrayOf(
          Match.ObjectIncluding({
            lane: Match.ObjectIncluding({
              id: String,
            }),
            communicator: Match.ObjectIncluding({
              id: String,
            }),
          }),
        ),
      }),
    });

    expect(() =>
      checkRuntime(
        {
          topology: {
            bindings: [
              {
                lane: { id: "lane-ok" },
                communicator: { id: "comm-ok" },
              },
            ],
          },
        },
        pattern,
      ),
    ).not.toThrow();

    const error = expectMatchFailure(() =>
      checkRuntime(
        {
          topology: {
            bindings: [
              {
                lane: { id: 123 },
                communicator: { id: "comm-bad" },
              },
            ],
          },
        },
        pattern,
      ),
    );
    expect(error.data.path).toBe("$.topology.bindings[0].lane.id");
  });

  it("supports OneOf and Where", () => {
    expect(() =>
      checkRuntime("abc", Match.OneOf(String, Number)),
    ).not.toThrow();
    expect(() => checkRuntime(123, Match.OneOf(String, Number))).not.toThrow();
    expectMatchFailure(() => checkRuntime(true, Match.OneOf(String, Number)));

    expect(() =>
      checkRuntime(
        "ABC",
        Match.Where((v: unknown) => v === "ABC"),
      ),
    ).not.toThrow();
    expectMatchFailure(() =>
      checkRuntime(
        "abc",
        Match.Where((v: unknown) => v === "ABC"),
      ),
    );
  });

  it("supports Match.Where message sugar with string, descriptor, and formatter values", () => {
    expect(() =>
      checkRuntime(
        "ABC",
        Match.Where(
          (value: unknown) => value === "ABC",
          "value must equal ABC",
        ),
      ),
    ).not.toThrow();

    const localizedPattern = Match.Where(
      (value: unknown, parent?: unknown): value is number => {
        expect(parent).toEqual({ retries: 0 });
        return typeof value === "number" && value > 0;
      },
      ({ value, error, path, parent, pattern }) => {
        expect(parent).toEqual({ retries: 0 });
        expect(value).toBe(0);
        expect(error.path).toBe("$.retries");
        expect(path).toBe("$.retries");
        expect(pattern).toBe(localizedPattern.pattern);
        return {
          message: `Retries are invalid at ${path}.`,
          code: "validation.retries.invalid",
          params: { value: String(value) },
        };
      },
    );

    const localizedError = expectMatchFailure(() =>
      checkRuntime(
        { retries: 0 },
        {
          retries: localizedPattern,
        },
      ),
    );

    expect(localizedError.message).toBe("Retries are invalid at $.retries.");
    expect(localizedError.data.failures[0]).toMatchObject({
      path: "$.retries",
      message: "Failed Match.Where validation at $.retries.",
      code: "validation.retries.invalid",
      params: { value: "0" },
    });

    const directError = expectMatchFailure(() =>
      checkRuntime(
        "abc",
        Match.Where((value: unknown) => value === "ABC", {
          message: "value must equal ABC",
          code: "validation.equals",
          params: { expected: "ABC" },
        }),
      ),
    );

    expect(directError.message).toBe("value must equal ABC");
    expect(directError.data.failures[0]).toMatchObject({
      path: "$",
      message: "Failed Match.Where validation at $.",
      code: "validation.equals",
      params: { expected: "ABC" },
    });
  });

  it("supports Match.Range with inclusive and exclusive bounds", () => {
    expect(() =>
      checkRuntime(1, Match.Range({ min: 1, max: 10 })),
    ).not.toThrow();
    expect(() =>
      checkRuntime(10, Match.Range({ min: 1, max: 10 })),
    ).not.toThrow();
    expect(() =>
      checkRuntime(5, Match.Range({ min: 1, max: 10 })),
    ).not.toThrow();
    expect(() =>
      checkRuntime(5, Match.Range({ min: 1, max: 10, inclusive: false })),
    ).not.toThrow();
    expect(() => checkRuntime(2, Match.Range({ min: 1 }))).not.toThrow();
    expect(() => checkRuntime(2, Match.Range({ max: 3 }))).not.toThrow();

    expectMatchFailure(() => checkRuntime(0, Match.Range({ min: 1, max: 10 })));
    expectMatchFailure(() =>
      checkRuntime(1, Match.Range({ min: 1, max: 10, inclusive: false })),
    );
    expectMatchFailure(() =>
      checkRuntime(10, Match.Range({ min: 1, max: 10, inclusive: false })),
    );
    expectMatchFailure(() =>
      checkRuntime(1, Match.Range({ min: 1, inclusive: false })),
    );
    expectMatchFailure(() => checkRuntime(4, Match.Range({ max: 3 })));
    expectMatchFailure(() =>
      checkRuntime(3, Match.Range({ max: 3, inclusive: false })),
    );
    expectMatchFailure(() =>
      checkRuntime(Number.POSITIVE_INFINITY, Match.Range({ min: 1 })),
    );
    expectMatchFailure(() => checkRuntime("5", Match.Range({ min: 1 })));
  });

  it("supports Match.Range integer mode", () => {
    expect(() =>
      checkRuntime(5, Match.Range({ min: 5, max: 10, integer: true })),
    ).not.toThrow();
    expect(() =>
      checkRuntime(10, Match.Range({ min: 5, max: 10, integer: true })),
    ).not.toThrow();
    expect(() =>
      checkRuntime(7, Match.Range({ min: 5, max: 10, integer: true })),
    ).not.toThrow();

    expectMatchFailure(() =>
      checkRuntime(7.5, Match.Range({ min: 5, max: 10, integer: true })),
    );
    expectMatchFailure(() =>
      checkRuntime(5.1, Match.Range({ min: 5, integer: true })),
    );
  });

  it("fails fast on invalid Match.Range pattern configs", () => {
    expect(() => Match.Range({})).toThrow(
      "Bad pattern: Match.Range requires at least one of min or max.",
    );
    expect(() => Match.Range({ min: Number.NaN })).toThrow(
      "Bad pattern: Match.Range min must be a finite number.",
    );
    expect(() => Match.Range({ max: Number.POSITIVE_INFINITY })).toThrow(
      "Bad pattern: Match.Range max must be a finite number.",
    );
    expect(() => Match.Range({ min: 2, max: 1 })).toThrow(
      "Bad pattern: Match.Range min cannot be greater than max.",
    );
    expect(() => Match.Range([] as never)).toThrow(
      "Bad pattern: Match.Range requires a plain object options bag.",
    );
    expect(() => Match.Range({ min: 1, inclusive: "yes" as never })).toThrow(
      "Bad pattern: Match.Range inclusive must be a boolean when provided.",
    );
    expect(() => Match.Range({ min: 1, integer: "yes" as never })).toThrow(
      "Bad pattern: Match.Range integer must be a boolean when provided.",
    );
  });

  it("passes parent to Match.Where and Match.WithMessage where applicable", () => {
    const seenParents: unknown[] = [];

    const emailPattern = Match.WithMessage(
      Match.Where((value: unknown, parent?: unknown) => {
        seenParents.push(parent);
        return value === "ada@example.com";
      }),
      ({ value, path, parent }) =>
        `Invalid email ${String(value)} at ${path} for ${(parent as { id?: string })?.id ?? "unknown"}`,
    );

    expect(() =>
      checkRuntime(
        {
          id: "user-1",
          email: "ada@example.com",
          tags: ["ok"],
        },
        {
          id: String,
          email: emailPattern,
          tags: [
            Match.Where((value: unknown, parent?: unknown) => {
              seenParents.push(parent);
              return value === "ok";
            }),
          ],
        },
      ),
    ).not.toThrow();

    expect(seenParents[0]).toEqual({
      id: "user-1",
      email: "ada@example.com",
      tags: ["ok"],
    });
    expect(seenParents[1]).toEqual(["ok"]);

    expect(() =>
      checkRuntime(
        {
          id: "user-2",
          email: "bad@example.com",
        },
        {
          id: String,
          email: emailPattern,
        },
      ),
    ).toThrow("Invalid email bad@example.com at $.email for user-2");
  });

  it("keeps aggregate summaries stable when Match.Where uses message sugar", () => {
    const aggregateError = expectMatchFailure(() =>
      checkRuntime(
        {
          first: 1,
          second: 2,
        } as any,
        {
          first: Match.Where(
            (value: unknown): value is string => value === "one",
            "first must equal one",
          ),
          second: Match.Where(
            (value: unknown): value is string => value === "two",
            "second must equal two",
          ),
        },
        { throwAllErrors: true },
      ),
    );

    expect(aggregateError.message).toContain(
      "Match failed with 2 errors:\n- Failed Match.Where validation at $.first.\n- Failed Match.Where validation at $.second.",
    );
    expect(aggregateError.data.failures).toHaveLength(2);
  });

  it("supports Match.RegExp with RegExp and source string inputs", () => {
    expect(() =>
      checkRuntime("abc-123", Match.RegExp(/^[a-z]+-\d+$/)),
    ).not.toThrow();
    expect(() =>
      checkRuntime("abc-123", Match.RegExp("^[a-z]+-\\d+$")),
    ).not.toThrow();

    expectMatchFailure(() =>
      checkRuntime("ABC-123", Match.RegExp(/^[a-z]+-\d+$/)),
    );
    expectMatchFailure(() => checkRuntime(123, Match.RegExp(/^[a-z]+-\d+$/)));
  });

  it("keeps Match.RegExp deterministic for stateful g/y regex flags", () => {
    const globalPattern = Match.RegExp(/foo/g);
    expect(() => checkRuntime("foo", globalPattern)).not.toThrow();
    expect(() => checkRuntime("foo", globalPattern)).not.toThrow();

    const stickyPattern = Match.RegExp(/foo/y);
    expect(() => checkRuntime("foo", stickyPattern)).not.toThrow();
    expect(() => checkRuntime("foo", stickyPattern)).not.toThrow();
  });

  it("throws invalid-pattern runner errors for invalid Match.RegExp source strings", () => {
    expect(() => checkRuntime("v", Match.RegExp("["))).toThrow(RunnerError);
    expect(() => Match.RegExp(123 as unknown as RegExp)).toThrow(RunnerError);
  });

  it("turns thrown Error values from Match.Where into Match failures", () => {
    const where = Match.Where(() => {
      throw new Error("where crashed");
    });

    expect(() => checkRuntime("value", where)).toThrow(
      "Failed Match.Where validation at $: Error: where crashed.",
    );
  });

  it("keeps raw Match.Where failures when message sugar wraps thrown predicates", () => {
    const error = expectMatchFailure(() =>
      checkRuntime(
        "value",
        Match.Where(() => {
          throw new Error("where crashed");
        }, "custom where message"),
      ),
    );

    expect(error.message).toBe("custom where message");
    expect(error.data.failures[0].message).toBe(
      "Failed Match.Where validation at $: Error: where crashed.",
    );
  });

  it("turns thrown non-Error values from Match.Where into Match failures", () => {
    expect(() =>
      checkRuntime(
        "x",
        Match.Where(() => {
          throw "boom";
        }),
      ),
    ).toThrow("Failed Match.Where validation at $: boom.");
  });

  it("throws invalid-pattern runner errors for unsupported patterns", () => {
    expect(() => checkRuntime(["a"], [String, Number])).toThrow(RunnerError);
    expect(() => checkRuntime("v", Match.OneOf())).toThrow(RunnerError);
    expect(() =>
      checkRuntime(
        "v",
        Match.Where("invalid" as unknown as (value: unknown) => boolean),
      ),
    ).toThrow(RunnerError);
    expect(() => Match.Where(() => true, null as never)).toThrow(RunnerError);
    expect(() => Match.Where(() => true, 42 as never)).toThrow(RunnerError);
    expect(() =>
      checkRuntime(
        "v",
        Match.ObjectIncluding(["invalid"] as unknown as Record<
          string,
          unknown
        >),
      ),
    ).toThrow(RunnerError);

    try {
      checkRuntime("value", /regex/ as unknown as never);
      throw new Error("Expected invalid pattern error");
    } catch (error) {
      expect(error).toBeInstanceOf(RunnerError);
      const runnerError = error as RunnerError<{ message: string }>;
      expect(runnerError.id).toBe(CHECK_INVALID_PATTERN_ERROR_ID);
      expect(checkInvalidPatternError.is(error)).toBe(true);
    }
  });

  it("rejects non-constructor functions as constructor patterns", () => {
    const anonymousConstructor = function () {
      return "x";
    };
    Object.defineProperty(anonymousConstructor, "name", { value: "" });
    expectMatchFailure(() => checkRuntime("x", anonymousConstructor));

    const invalidNamedConstructor = function NamedPattern() {
      return "x";
    };
    Object.defineProperty(invalidNamedConstructor, Symbol.hasInstance, {
      value: () => {
        throw new Error("broken hasInstance");
      },
    });
    expect(() => checkRuntime("x", invalidNamedConstructor)).toThrow(
      RunnerError,
    );

    const invalidAnonymousConstructor = function () {
      return "x";
    };
    Object.defineProperty(invalidAnonymousConstructor, "name", { value: "" });
    Object.defineProperty(invalidAnonymousConstructor, Symbol.hasInstance, {
      value: () => {
        throw new Error("broken hasInstance");
      },
    });
    expect(() => checkRuntime("x", invalidAnonymousConstructor)).toThrow(
      RunnerError,
    );
  });

  it("reports Date as actual type when mismatching", () => {
    const error = expectMatchFailure(() => checkRuntime(new Date(), String));
    expect(error.data.failures[0].actualType).toBe("Date");
  });

  it("falls back to generic object type when constructor name is unavailable", () => {
    const nullPrototypeObject = Object.create(null) as Record<string, unknown>;
    nullPrototypeObject.id = 10;

    const error = expectMatchFailure(() =>
      checkRuntime(nullPrototypeObject, String),
    );
    expect(error.data.failures[0].actualType).toBe("object");
  });

  it("builds a stable root failure when a match error is created without failures", () => {
    const err = createMatchError([]);
    expect(err.data.path).toBe("$");
    expect(err.data.failures).toHaveLength(1);
    expect(err.data.failures[0].message).toBe("Match failed at $.");
  });

  it("lets the built-in match error helper format empty failures safely", () => {
    const err = matchError.new({
      path: "$",
      failures: [],
    });

    expect(err.message).toContain("Match failed at $.");
    expect(err.httpCode).toBe(400);
  });

  it("Match.test returns true on success and false on mismatch", () => {
    expect(Match.test({ id: "1" }, { id: String })).toBe(true);
    expect(Match.test({ id: 1 }, { id: String })).toBe(false);
  });

  it("Match.test can be used as a type guard for typed patterns", () => {
    const candidate: unknown = new Date();
    const isDate = Match.Where(
      (value: unknown): value is Date => value instanceof Date,
    );

    if (!Match.test(candidate, isDate)) {
      throw new Error("Expected candidate to match Date guard");
    }

    expect(candidate.getTime()).toBeGreaterThan(0);
  });

  it("Match.test returns false when Match.Where throws", () => {
    expect(
      Match.test(
        "x",
        Match.Where(() => {
          throw new Error("boom");
        }),
      ),
    ).toBe(false);
  });
});
