import {
  MATCH_ERROR_ID,
  CHECK_INVALID_OPTIONS_ERROR_ID,
  Match,
  check,
} from "../../tools/check";
import {
  checkInvalidOptionsError,
  matchError,
} from "../../errors/foundation/match.errors";

const checkRuntime = check as (
  value: unknown,
  pattern: unknown,
  options?: { errorPolicy?: "first" | "all"; throwAllErrors?: boolean },
) => unknown;

function expectMatchFailure(
  run: () => unknown,
): ReturnType<typeof matchError.new> {
  try {
    run();
    throw new Error("Expected match error");
  } catch (error) {
    expect(matchError.is(error)).toBe(true);
    return error as ReturnType<typeof matchError.new>;
  }
}

describe("tools/check errorPolicy", () => {
  it('collects all failures when errorPolicy is "all"', () => {
    const error = expectMatchFailure(() =>
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
      ),
    );

    expect(error.id).toBe(MATCH_ERROR_ID);
    expect(error.data.failures.length).toBe(5);
    expect(error.data.failures.map((f) => f.path)).toEqual(
      expect.arrayContaining([
        "$.extra",
        "$.user.name",
        "$.user.age",
        "$.tags[0]",
        "$.tags[2]",
      ]),
    );
  });

  it("keeps fail-fast behavior when throwAllErrors is not enabled", () => {
    const error = expectMatchFailure(() =>
      checkRuntime({ a: 1, b: 2 }, { a: String, b: String }),
    );

    expect(error.data.failures).toHaveLength(1);
    expect(error.data.path).toBe("$.a");
  });

  it("treats an empty options object like the default fail-fast policy", () => {
    const error = expectMatchFailure(() =>
      checkRuntime({ a: 1, b: 2 }, { a: String, b: String }, {}),
    );

    expect(error.data.failures).toHaveLength(1);
    expect(error.data.path).toBe("$.a");
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

    try {
      checkRuntime(
        "x",
        String,
        null as unknown as { throwAllErrors?: boolean },
      );
    } catch (error) {
      expect(checkInvalidOptionsError.is(error)).toBe(true);
    }
  });

  it("keeps the deprecated throwAllErrors alias working", () => {
    const error = expectMatchFailure(() =>
      checkRuntime(
        { a: 1, b: 2 },
        { a: String, b: String },
        {
          throwAllErrors: true,
        },
      ),
    );

    expect(error.data.failures).toHaveLength(2);
  });

  it("maps throwAllErrors: false to the first-error policy", () => {
    const error = expectMatchFailure(() =>
      checkRuntime(
        { a: 1, b: 2 },
        { a: String, b: String },
        {
          throwAllErrors: false,
        },
      ),
    );

    expect(error.data.failures).toHaveLength(1);
  });

  it("lets errorPolicy override the deprecated throwAllErrors alias", () => {
    const error = expectMatchFailure(() =>
      checkRuntime(
        { a: 1, b: 2 },
        { a: String, b: String },
        { errorPolicy: "first", throwAllErrors: true },
      ),
    );

    expect(error.data.failures).toHaveLength(1);
    expect(error.data.path).toBe("$.a");
  });

  it("handles aggregate policy with OneOf and Maybe", () => {
    expect(() =>
      checkRuntime("x", Match.OneOf(String, Number), { errorPolicy: "all" }),
    ).not.toThrow();

    expectMatchFailure(() =>
      checkRuntime(true, Match.OneOf(Match.Maybe(String), Number), {
        errorPolicy: "all",
      }),
    );
  });

  it("aggregates nested failures for Match.ObjectStrict and Match.MapOf", () => {
    const error = expectMatchFailure(() =>
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
      ),
    );

    expect(error.data.failures.map((failure) => failure.path)).toEqual(
      expect.arrayContaining([
        "$.extra",
        "$.lanes.worker.id",
        "$.lanes.api.id",
      ]),
    );
  });

  it("supports Match.WithErrorPolicy wrappers as schema defaults", () => {
    const error = expectMatchFailure(() =>
      checkRuntime(
        { a: 1, b: 2 },
        Match.WithErrorPolicy({ a: String, b: String }, "all"),
      ),
    );

    expect(error.data.failures).toHaveLength(2);
  });

  it("lets explicit check options override Match.WithErrorPolicy defaults", () => {
    const error = expectMatchFailure(() =>
      checkRuntime(
        { a: 1, b: 2 },
        Match.WithErrorPolicy({ a: String, b: String }, "all"),
        { errorPolicy: "first" },
      ),
    );

    expect(error.data.failures).toHaveLength(1);
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
