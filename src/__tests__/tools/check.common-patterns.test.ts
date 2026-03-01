import { Match, MatchError, check } from "../../tools/check";

describe("tools/check common match patterns", () => {
  it("validates Email, UUID, URL and IsoDateString", () => {
    expect(() => check("dev@example.com", Match.Email)).not.toThrow();
    expect(() => check("not-an-email", Match.Email)).toThrow(MatchError);

    expect(() =>
      check("123e4567-e89b-42d3-a456-426614174000", Match.UUID),
    ).not.toThrow();
    expect(() =>
      check("123e4567-e89b-12d3-a456-426614174000", Match.UUID),
    ).not.toThrow();
    expect(() => check("not-a-uuid", Match.UUID)).toThrow(MatchError);

    expect(() =>
      check("https://example.com/path?q=1", Match.URL),
    ).not.toThrow();
    expect(() => check(123, Match.URL)).toThrow(MatchError);
    expect(() => check("not a url", Match.URL)).toThrow(MatchError);

    expect(() =>
      check("2026-01-01T10:20:30Z", Match.IsoDateString),
    ).not.toThrow();
    expect(() =>
      check("2026-01-01T10:20:30+02:00", Match.IsoDateString),
    ).not.toThrow();
    expect(() => check("2026-13-01T10:20:30Z", Match.IsoDateString)).toThrow(
      MatchError,
    );
    expect(() => check("2026-01-01", Match.IsoDateString)).toThrow(MatchError);
  });

  it("validates NonEmptyArray with and without element pattern", () => {
    expect(() => check([1], Match.NonEmptyArray())).not.toThrow();
    expect(() => check([], Match.NonEmptyArray())).toThrow(MatchError);

    expect(() => check(["a", "b"], Match.NonEmptyArray(String))).not.toThrow();
    expect(() => check([1, "b"], Match.NonEmptyArray(String))).toThrow(
      MatchError,
    );
  });

  it("validates PositiveInteger", () => {
    expect(() => check(0, Match.PositiveInteger)).not.toThrow();
    expect(() => check(2, Match.PositiveInteger)).not.toThrow();
    expect(() => check(-1, Match.PositiveInteger)).toThrow(MatchError);
    expect(() => check(1.5, Match.PositiveInteger)).toThrow(MatchError);
  });
});
