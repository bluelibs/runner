import {
  CHECK_ERROR_ID,
  CHECK_INVALID_OPTIONS_ERROR_ID,
  Match,
  MatchError,
  check,
} from "../../tools/check";

const checkRuntime = check as (
  value: unknown,
  pattern: unknown,
  options?: { throwAllErrors?: boolean },
) => unknown;

describe("tools/check throwAllErrors", () => {
  it("collects all failures when throwAllErrors is true", () => {
    try {
      checkRuntime(
        {
          user: {
            name: 10,
            age: "19",
          },
          tags: [1, "ok", false],
          extra: true,
        },
        {
          user: {
            name: String,
            age: Number,
          },
          tags: [String],
        },
        { throwAllErrors: true },
      );
      throw new Error("Expected MatchError");
    } catch (error) {
      expect(error).toBeInstanceOf(MatchError);
      const matchError = error as MatchError;
      expect(matchError.id).toBe(CHECK_ERROR_ID);
      expect(matchError.failures.length).toBe(5);
      expect(matchError.failures.map((f) => f.path)).toEqual(
        expect.arrayContaining([
          "$.extra",
          "$.user.name",
          "$.user.age",
          "$.tags[0]",
          "$.tags[2]",
        ]),
      );
    }
  });

  it("keeps fail-fast behavior when throwAllErrors is not enabled", () => {
    try {
      checkRuntime({ a: 1, b: 2 }, { a: String, b: String });
      throw new Error("Expected MatchError");
    } catch (error) {
      expect(error).toBeInstanceOf(MatchError);
      const matchError = error as MatchError;
      expect(matchError.failures).toHaveLength(1);
      expect(matchError.path).toBe("$.a");
    }
  });

  it("throws option errors for invalid options objects", () => {
    expect(() =>
      checkRuntime(
        "x",
        String,
        null as unknown as { throwAllErrors?: boolean },
      ),
    ).toThrow(
      expect.objectContaining({
        id: CHECK_INVALID_OPTIONS_ERROR_ID,
      }),
    );

    expect(() =>
      checkRuntime("x", String, {
        throwAllErrors: "true" as unknown as boolean,
      }),
    ).toThrow(
      expect.objectContaining({
        id: CHECK_INVALID_OPTIONS_ERROR_ID,
      }),
    );
  });

  it("handles throwAllErrors with OneOf and Maybe", () => {
    expect(() =>
      checkRuntime("x", Match.OneOf(String, Number), { throwAllErrors: true }),
    ).not.toThrow();

    expect(() =>
      checkRuntime(true, Match.OneOf(Match.Maybe(String), Number), {
        throwAllErrors: true,
      }),
    ).toThrow(MatchError);
  });

  it("aggregates nested failures for Match.ObjectStrict and Match.MapOf", () => {
    try {
      checkRuntime(
        {
          lanes: {
            worker: { id: 1 },
            api: { id: 2 },
          },
          extra: true,
        },
        Match.ObjectStrict({
          lanes: Match.MapOf({
            id: String,
          }),
        }),
        { throwAllErrors: true },
      );
      throw new Error("Expected MatchError");
    } catch (error) {
      expect(error).toBeInstanceOf(MatchError);
      const matchError = error as MatchError;
      expect(matchError.failures.map((failure) => failure.path)).toEqual(
        expect.arrayContaining([
          "$.extra",
          "$.lanes.worker.id",
          "$.lanes.api.id",
        ]),
      );
    }
  });
});
