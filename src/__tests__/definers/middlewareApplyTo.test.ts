import { normalizeMiddlewareApplyTo } from "../../definers/middlewareApplyTo";

describe("middleware applyTo normalization", () => {
  it("normalizes applyTo where-visible", () => {
    const result = normalizeMiddlewareApplyTo(
      "tests.applyTo.normalize.visible",
      { scope: "where-visible" },
    );

    expect(result).toEqual({ scope: "where-visible", when: undefined });
  });

  it("normalizes applyTo subtree", () => {
    const when = (target: { id: string }) => target.id.startsWith("a");
    const result = normalizeMiddlewareApplyTo(
      "tests.applyTo.normalize.subtree",
      { scope: "subtree", when },
    );

    expect(result).toEqual({ scope: "subtree", when });
  });

  it("throws on invalid applyTo scope", () => {
    expect(() =>
      normalizeMiddlewareApplyTo("tests.applyTo.normalize.invalid.scope", {
        scope: "invalid" as "where-visible",
      }),
    ).toThrow(
      /Middleware applyTo validation failed for tests\.applyTo\.normalize\.invalid\.scope/,
    );
  });

  it("throws on invalid applyTo.when", () => {
    expect(() =>
      normalizeMiddlewareApplyTo("tests.applyTo.normalize.invalid.when", {
        scope: "where-visible",
        when: "nope" as unknown as (target: { id: string }) => boolean,
      }),
    ).toThrow(
      /Middleware applyTo validation failed for tests\.applyTo\.normalize\.invalid\.when/,
    );
  });
});
