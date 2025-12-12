import { normalizeThrows } from "../../tools/throws";
import { definitions } from "../..";

describe("normalizeThrows()", () => {
  const owner = { kind: "task" as const, id: "spec.task" };

  it("returns undefined when not provided", () => {
    expect(normalizeThrows(owner, undefined)).toBeUndefined();
  });

  it("normalizes ids and deduplicates", () => {
    const err = { id: "spec.errors.fake", [definitions.symbolError]: true } as any;
    expect(normalizeThrows(owner, ["a", err, "a"] as any)).toEqual([
      "a",
      "spec.errors.fake",
    ]);
  });

  it("throws on whitespace-only string ids", () => {
    expect(() => normalizeThrows(owner, ["   "] as any)).toThrow(
      /Invalid throws entry/,
    );
  });

  it("throws on invalid error helpers (empty id)", () => {
    const bad = { id: "   ", [definitions.symbolError]: true } as any;
    expect(() => normalizeThrows(owner, [bad] as any)).toThrow(
      /Invalid throws entry/,
    );
  });

  it("throws with useful got types", () => {
    expect(() => normalizeThrows(owner, [null] as any)).toThrow(/got null/);
    expect(() => normalizeThrows(owner, [[]] as any)).toThrow(/got array/);
    expect(() => normalizeThrows(owner, [123] as any)).toThrow(/got number/);
  });
});

