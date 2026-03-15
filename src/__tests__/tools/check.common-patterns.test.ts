import { matchError } from "../../errors/foundation/match.errors";
import { Match, check } from "../../tools/check";

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

describe("tools/check common match patterns", () => {
  it("validates Email, UUID, URL and IsoDateString", () => {
    expect(() => check("dev@example.com", Match.Email)).not.toThrow();
    expectMatchFailure(() => check("not-an-email", Match.Email));

    expect(() =>
      check("123e4567-e89b-42d3-a456-426614174000", Match.UUID),
    ).not.toThrow();
    expect(() =>
      check("123e4567-e89b-12d3-a456-426614174000", Match.UUID),
    ).not.toThrow();
    expectMatchFailure(() => check("not-a-uuid", Match.UUID));

    expect(() =>
      check("https://example.com/path?q=1", Match.URL),
    ).not.toThrow();
    expectMatchFailure(() => check(123, Match.URL));
    expectMatchFailure(() => check("not a url", Match.URL));

    expect(() =>
      check("2026-01-01T10:20:30Z", Match.IsoDateString),
    ).not.toThrow();
    expect(() =>
      check("2026-01-01T10:20:30+02:00", Match.IsoDateString),
    ).not.toThrow();
    expectMatchFailure(() =>
      check("2026-13-01T10:20:30Z", Match.IsoDateString),
    );
    expectMatchFailure(() => check("2026-01-01", Match.IsoDateString));
  });

  it("validates NonEmptyArray with and without element pattern", () => {
    expect(() => check([1], Match.NonEmptyArray())).not.toThrow();
    expectMatchFailure(() => check([], Match.NonEmptyArray()));

    expect(() => check(["a", "b"], Match.NonEmptyArray(String))).not.toThrow();
    expectMatchFailure(() => check([1, "b"], Match.NonEmptyArray(String)));
  });

  it("validates PositiveInteger", () => {
    expect(() => check(0, Match.PositiveInteger)).not.toThrow();
    expect(() => check(2, Match.PositiveInteger)).not.toThrow();
    expectMatchFailure(() => check(-1, Match.PositiveInteger));
    expectMatchFailure(() => check(1.5, Match.PositiveInteger));
  });

  it("validates Match.RegExp patterns", () => {
    expect(() => check("runner", Match.RegExp(/^runner$/))).not.toThrow();
    expect(() => check("runner", Match.RegExp("^runner$"))).not.toThrow();
    expectMatchFailure(() => check("Runner", Match.RegExp(/^runner$/)));
    expectMatchFailure(() => check(123, Match.RegExp(/^runner$/)));
  });
});
