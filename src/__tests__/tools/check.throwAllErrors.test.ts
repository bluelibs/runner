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
  options?: { errorPolicy?: "first" | "all"; throwAllErrors?: boolean },
) => unknown;

describe("tools/check errorPolicy", () => {
  it('collects all failures when errorPolicy is "all"', () => {
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
        { errorPolicy: "all" },
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

  it("treats an empty options object like the default fail-fast policy", () => {
    try {
      checkRuntime({ a: 1, b: 2 }, { a: String, b: String }, {});
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

    expect(() =>
      checkRuntime("x", String, {
        errorPolicy: "many" as unknown as "all",
      }),
    ).toThrow(
      expect.objectContaining({
        id: CHECK_INVALID_OPTIONS_ERROR_ID,
      }),
    );
  });

  it("keeps the deprecated throwAllErrors alias working", () => {
    try {
      checkRuntime(
        { a: 1, b: 2 },
        { a: String, b: String },
        {
          throwAllErrors: true,
        },
      );
      throw new Error("Expected MatchError");
    } catch (error) {
      expect(error).toBeInstanceOf(MatchError);
      const matchError = error as MatchError;
      expect(matchError.failures).toHaveLength(2);
    }
  });

  it("maps throwAllErrors: false to the first-error policy", () => {
    try {
      checkRuntime(
        { a: 1, b: 2 },
        { a: String, b: String },
        {
          throwAllErrors: false,
        },
      );
      throw new Error("Expected MatchError");
    } catch (error) {
      expect(error).toBeInstanceOf(MatchError);
      const matchError = error as MatchError;
      expect(matchError.failures).toHaveLength(1);
    }
  });

  it("lets errorPolicy override the deprecated throwAllErrors alias", () => {
    try {
      checkRuntime(
        { a: 1, b: 2 },
        { a: String, b: String },
        { errorPolicy: "first", throwAllErrors: true },
      );
      throw new Error("Expected MatchError");
    } catch (error) {
      expect(error).toBeInstanceOf(MatchError);
      const matchError = error as MatchError;
      expect(matchError.failures).toHaveLength(1);
      expect(matchError.path).toBe("$.a");
    }
  });

  it("handles aggregate policy with OneOf and Maybe", () => {
    expect(() =>
      checkRuntime("x", Match.OneOf(String, Number), { errorPolicy: "all" }),
    ).not.toThrow();

    expect(() =>
      checkRuntime(true, Match.OneOf(Match.Maybe(String), Number), {
        errorPolicy: "all",
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
        { errorPolicy: "all" },
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

  it("supports Match.WithErrorPolicy wrappers as schema defaults", () => {
    try {
      checkRuntime(
        { a: 1, b: 2 },
        Match.WithErrorPolicy({ a: String, b: String }, "all"),
      );
      throw new Error("Expected MatchError");
    } catch (error) {
      expect(error).toBeInstanceOf(MatchError);
      const matchError = error as MatchError;
      expect(matchError.failures).toHaveLength(2);
    }
  });

  it("lets explicit check options override Match.WithErrorPolicy defaults", () => {
    try {
      checkRuntime(
        { a: 1, b: 2 },
        Match.WithErrorPolicy({ a: String, b: String }, "all"),
        { errorPolicy: "first" },
      );
      throw new Error("Expected MatchError");
    } catch (error) {
      expect(error).toBeInstanceOf(MatchError);
      const matchError = error as MatchError;
      expect(matchError.failures).toHaveLength(1);
    }
  });

  it("preserves Match.WithErrorPolicy defaults through Match.compile().parse()", () => {
    const compiled = Match.compile(
      Match.WithErrorPolicy({ a: String, b: String }, "all"),
    );

    expect(() => compiled.parse({ a: 1, b: 2 })).toThrow(
      expect.objectContaining({
        failures: expect.arrayContaining([
          expect.objectContaining({ path: "$.a" }),
          expect.objectContaining({ path: "$.b" }),
        ]),
      }),
    );
  });
});
