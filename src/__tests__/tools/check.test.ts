import { RunnerError } from "../../definers/defineError";
import {
  CHECK_INVALID_PATTERN_ERROR_ID,
  Match,
  MatchError,
  check,
} from "../../tools/check";

const checkRuntime = check as (
  value: unknown,
  pattern: unknown,
  options?: { throwAllErrors?: boolean },
) => unknown;

class User {
  constructor(public readonly id: string) {}
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

    expect(() => checkRuntime("x", Boolean)).toThrow(Match.Error);
    expect(() => checkRuntime("x", Function)).toThrow(Match.Error);
    expect(() => checkRuntime([], Object)).toThrow(Match.Error);
    expect(() => checkRuntime("x", Array)).toThrow(Match.Error);
  });

  it("supports literal patterns", () => {
    expect(() => checkRuntime("a", "a")).not.toThrow();
    expect(() => checkRuntime(10, 10)).not.toThrow();
    expect(() => checkRuntime(undefined, undefined)).not.toThrow();
    expect(() => checkRuntime(null, null)).not.toThrow();
    expect(() => checkRuntime(1n, 1n)).not.toThrow();

    const symbol = Symbol("check");
    expect(() => checkRuntime(symbol, symbol)).not.toThrow();
    expect(() => checkRuntime("b", "a")).toThrow(Match.Error);
  });

  it("supports custom constructor patterns", () => {
    expect(() => checkRuntime(new User("u1"), User)).not.toThrow();
    expect(() => checkRuntime({ id: "u1" }, User)).toThrow(Match.Error);
  });

  it("matches Match.Any, Match.Integer and Match.NonEmptyString", () => {
    expect(() => checkRuntime({ anything: true }, Match.Any)).not.toThrow();
    expect(() => checkRuntime(12, Match.Integer)).not.toThrow();
    expect(() => checkRuntime("name", Match.NonEmptyString)).not.toThrow();

    expect(() => checkRuntime(1.2, Match.Integer)).toThrow(Match.Error);
    expect(() => checkRuntime(2147483648, Match.Integer)).toThrow(Match.Error);
    expect(() => checkRuntime("", Match.NonEmptyString)).toThrow(Match.Error);
  });

  it("handles Maybe and Optional wrappers", () => {
    expect(() => checkRuntime(undefined, Match.Optional(String))).not.toThrow();
    expect(() => checkRuntime("ok", Match.Optional(String))).not.toThrow();
    expect(() => checkRuntime(undefined, Match.Maybe(String))).not.toThrow();
    expect(() => checkRuntime(null, Match.Maybe(String))).not.toThrow();
    expect(() => checkRuntime("ok", Match.Maybe(String))).not.toThrow();

    expect(() => checkRuntime(null, Match.Optional(String))).toThrow(
      Match.Error,
    );
    expect(() => checkRuntime(7, Match.Maybe(String))).toThrow(Match.Error);
  });

  it("validates arrays using one-element array patterns", () => {
    expect(() => checkRuntime(["a", "b"], [String])).not.toThrow();
    expect(() => checkRuntime([1, "b"], [String])).toThrow(Match.Error);
    expect(() => checkRuntime("not-array", [String])).toThrow(Match.Error);
  });

  it("validates strict object patterns and produces paths", () => {
    try {
      checkRuntime(
        { profile: { name: 10 } },
        {
          profile: {
            name: String,
          },
        },
      );
      throw new Error("Expected Match.Error");
    } catch (error) {
      expect(error).toBeInstanceOf(Match.Error);
      const matchError = error as InstanceType<typeof Match.Error>;
      expect(matchError.path).toBe("$.profile.name");
      expect(matchError.failures[0].path).toBe("$.profile.name");
    }
  });

  it("formats non-identifier keys using bracket notation in failure paths", () => {
    try {
      checkRuntime(
        {
          "full-name": 10,
        },
        {
          "full-name": String,
        },
      );
      throw new Error("Expected Match.Error");
    } catch (error) {
      expect(error).toBeInstanceOf(Match.Error);
      const matchError = error as InstanceType<typeof Match.Error>;
      expect(matchError.path).toBe('$["full-name"]');
    }
  });

  it("requires plain objects for plain-object patterns", () => {
    expect(() => checkRuntime([], { id: String })).toThrow(Match.Error);
  });

  it("rejects unknown object keys by default and allows them with ObjectIncluding", () => {
    expect(() =>
      checkRuntime(
        { id: "1", extra: true },
        {
          id: String,
        },
      ),
    ).toThrow(Match.Error);

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

    expect(() =>
      checkRuntime(
        { id: "1", extra: true },
        Match.ObjectStrict({
          id: String,
        }),
      ),
    ).toThrow(Match.Error);
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

    expect(() =>
      checkRuntime(
        {
          a: { id: 1 },
        },
        Match.MapOf({
          id: String,
        }),
      ),
    ).toThrow(Match.Error);
  });

  it("requires required object keys even when the pattern is Match.Any", () => {
    expect(() =>
      checkRuntime(
        {},
        Match.ObjectIncluding({
          value: Match.Any,
        }),
      ),
    ).toThrow(Match.Error);

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

    try {
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
      );
      throw new Error("Expected Match.Error");
    } catch (error) {
      expect(error).toBeInstanceOf(Match.Error);
      const matchError = error as InstanceType<typeof Match.Error>;
      expect(matchError.path).toBe("$.topology.bindings[0].lane.id");
    }
  });

  it("supports OneOf and Where", () => {
    expect(() =>
      checkRuntime("abc", Match.OneOf(String, Number)),
    ).not.toThrow();
    expect(() => checkRuntime(123, Match.OneOf(String, Number))).not.toThrow();
    expect(() => checkRuntime(true, Match.OneOf(String, Number))).toThrow(
      Match.Error,
    );

    expect(() =>
      checkRuntime(
        "ABC",
        Match.Where((v: unknown) => v === "ABC"),
      ),
    ).not.toThrow();
    expect(() =>
      checkRuntime(
        "abc",
        Match.Where((v: unknown) => v === "ABC"),
      ),
    ).toThrow(Match.Error);
  });

  it("supports Match.RegExp with RegExp and source string inputs", () => {
    expect(() =>
      checkRuntime("abc-123", Match.RegExp(/^[a-z]+-\d+$/)),
    ).not.toThrow();
    expect(() =>
      checkRuntime("abc-123", Match.RegExp("^[a-z]+-\\d+$")),
    ).not.toThrow();

    expect(() => checkRuntime("ABC-123", Match.RegExp(/^[a-z]+-\d+$/))).toThrow(
      Match.Error,
    );
    expect(() => checkRuntime(123, Match.RegExp(/^[a-z]+-\d+$/))).toThrow(
      Match.Error,
    );
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

  it("treats Match.Error thrown from Match.Where as validation failure", () => {
    const where = Match.Where(() => {
      throw new Match.Error([
        {
          path: "$",
          expected: "custom",
          actualType: "unknown",
          message: "custom failure",
        },
      ]);
    });

    expect(() => checkRuntime("value", where)).toThrow(Match.Error);
  });

  it("rethrows non-match errors thrown from Match.Where", () => {
    const plannedError = new Error("where crashed");
    expect(() =>
      checkRuntime(
        "x",
        Match.Where(() => {
          throw plannedError;
        }),
      ),
    ).toThrow("where crashed");
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
    }
  });

  it("rejects non-constructor functions as constructor patterns", () => {
    const anonymousConstructor = function () {
      return "x";
    };
    Object.defineProperty(anonymousConstructor, "name", { value: "" });
    expect(() => checkRuntime("x", anonymousConstructor)).toThrow(Match.Error);

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
    try {
      checkRuntime(new Date(), String);
      throw new Error("Expected Match.Error");
    } catch (error) {
      expect(error).toBeInstanceOf(Match.Error);
      const matchError = error as InstanceType<typeof Match.Error>;
      expect(matchError.failures[0].actualType).toBe("Date");
    }
  });

  it("falls back to generic object type when constructor name is unavailable", () => {
    const nullPrototypeObject = Object.create(null) as Record<string, unknown>;
    nullPrototypeObject.id = 10;

    try {
      checkRuntime(nullPrototypeObject, String);
      throw new Error("Expected Match.Error");
    } catch (error) {
      expect(error).toBeInstanceOf(Match.Error);
      const matchError = error as InstanceType<typeof Match.Error>;
      expect(matchError.failures[0].actualType).toBe("object");
    }
  });

  it("builds a stable root failure when MatchError is constructed without failures", () => {
    const err = new MatchError([]);
    expect(err.path).toBe("$");
    expect(err.failures).toHaveLength(1);
    expect(err.failures[0].message).toBe("Match failed at $.");
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

  it("Match.test rethrows non-match errors", () => {
    const plannedError = new Error("boom");
    expect(() =>
      Match.test(
        "x",
        Match.Where(() => {
          throw plannedError;
        }),
      ),
    ).toThrow("boom");
  });
});
