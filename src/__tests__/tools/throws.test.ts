import { normalizeThrows } from "../../tools/throws";
import { definitions } from "../..";
import { ThrowsList, IErrorHelper } from "../../types/error";

describe("normalizeThrows()", () => {
  const owner = { kind: "task" as const, id: "spec.task" };

  it("returns undefined when not provided", () => {
    expect(normalizeThrows(owner, undefined)).toBeUndefined();
  });

  it("normalizes ids and deduplicates", () => {
    const err = {
      id: "spec.errors.fake",
      [definitions.symbolError]: true,
    } as unknown as IErrorHelper;
    expect(normalizeThrows(owner, ["a", err, "a"])).toEqual([
      "a",
      "spec.errors.fake",
    ]);
  });

  it("throws on whitespace-only string ids", () => {
    expect(() => normalizeThrows(owner, ["   "])).toThrow(
      /Invalid throws entry/,
    );
  });

  it("throws on invalid error helpers (empty id)", () => {
    const bad = {
      id: "   ",
      [definitions.symbolError]: true,
    } as unknown as IErrorHelper;
    expect(() => normalizeThrows(owner, [bad])).toThrow(/Invalid throws entry/);
  });

  it("throws with useful got types", () => {
    expect(() =>
      normalizeThrows(owner, [null] as unknown as ThrowsList),
    ).toThrow(/got null/);
    expect(() => normalizeThrows(owner, [[]] as unknown as ThrowsList)).toThrow(
      /got array/,
    );
    expect(() =>
      normalizeThrows(owner, [123] as unknown as ThrowsList),
    ).toThrow(/got number/);
  });
});
