import { normalizeMiddlewareApplyTo } from "../../definers/middlewareApplyTo";

describe("middleware applyTo normalization", () => {
  it("normalizes applyTo where-visible", () => {
    const result = normalizeMiddlewareApplyTo(
      "tests.applyTo.normalize.visible",
      { scope: "where-visible" },
      undefined,
    );

    expect(result.applyTo).toEqual({ scope: "where-visible", when: undefined });
    expect(result.everywhere).toBe(true);
  });

  it("normalizes applyTo subtree", () => {
    const when = (target: { id: string }) => target.id.startsWith("a");
    const result = normalizeMiddlewareApplyTo(
      "tests.applyTo.normalize.subtree",
      { scope: "subtree", when },
      undefined,
    );

    expect(result.applyTo).toEqual({ scope: "subtree", when });
    expect(result.everywhere).toBeUndefined();
  });

  it("normalizes legacy everywhere values", () => {
    const when = (target: { id: string }) => target.id.endsWith(".ok");

    expect(
      normalizeMiddlewareApplyTo(
        "tests.applyTo.normalize.legacy.true",
        undefined,
        true,
      ),
    ).toEqual({
      applyTo: { scope: "where-visible" },
      everywhere: true,
    });

    expect(
      normalizeMiddlewareApplyTo(
        "tests.applyTo.normalize.legacy.false",
        undefined,
        false,
      ),
    ).toEqual({
      applyTo: undefined,
      everywhere: false,
    });

    expect(
      normalizeMiddlewareApplyTo(
        "tests.applyTo.normalize.legacy.fn",
        undefined,
        when,
      ),
    ).toEqual({
      applyTo: { scope: "where-visible", when },
      everywhere: when,
    });
  });

  it("throws when both applyTo and everywhere are provided", () => {
    expect(() =>
      normalizeMiddlewareApplyTo(
        "tests.applyTo.normalize.conflict",
        { scope: "where-visible" },
        true,
      ),
    ).toThrow(
      /Middleware applyTo validation failed for tests\.applyTo\.normalize\.conflict/,
    );
  });

  it("throws on invalid applyTo scope", () => {
    expect(() =>
      normalizeMiddlewareApplyTo(
        "tests.applyTo.normalize.invalid.scope",
        { scope: "invalid" as "where-visible" },
        undefined,
      ),
    ).toThrow(
      /Middleware applyTo validation failed for tests\.applyTo\.normalize\.invalid\.scope/,
    );
  });

  it("throws on invalid applyTo.when", () => {
    expect(() =>
      normalizeMiddlewareApplyTo(
        "tests.applyTo.normalize.invalid.when",
        {
          scope: "where-visible",
          when: "nope" as unknown as (target: { id: string }) => boolean,
        },
        undefined,
      ),
    ).toThrow(
      /Middleware applyTo validation failed for tests\.applyTo\.normalize\.invalid\.when/,
    );
  });

  it("throws on invalid legacy everywhere value", () => {
    expect(() =>
      normalizeMiddlewareApplyTo(
        "tests.applyTo.normalize.invalid.everywhere",
        undefined,
        "nope" as unknown as boolean,
      ),
    ).toThrow(
      /Middleware applyTo validation failed for tests\.applyTo\.normalize\.invalid\.everywhere/,
    );
  });
});
