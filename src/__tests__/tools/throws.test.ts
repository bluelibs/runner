import { normalizeThrows } from "../../tools/throws";
import { definitions } from "../..";
import { ThrowsDeclaration, IErrorHelper } from "../../types/error";

describe("normalizeThrows()", () => {
  const owner = { kind: "task" as const, id: "spec-task" };

  function createErrorHelper(id: string): IErrorHelper {
    return {
      id,
      [definitions.symbolError]: true,
    } as unknown as IErrorHelper;
  }

  it("returns undefined when not provided", () => {
    expect(normalizeThrows(owner, undefined)).toBeUndefined();
  });

  it("normalizes helper ids and deduplicates", () => {
    const errA = createErrorHelper("spec-errors-a");
    const errB = createErrorHelper("spec-errors-b");
    expect(normalizeThrows(owner, [errA, errB, errA])).toEqual([
      "spec-errors-a",
      "spec-errors-b",
    ]);
  });

  it("accepts pre-normalized string ids and deduplicates", () => {
    expect(
      normalizeThrows(owner, ["spec-errors-string", "spec-errors-string"]),
    ).toEqual(["spec-errors-string"]);
  });

  it("throws on empty string ids", () => {
    expect(() => normalizeThrows(owner, ["   "] as ThrowsDeclaration)).toThrow(
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
      normalizeThrows(owner, [null] as unknown as ThrowsDeclaration),
    ).toThrow(/got null/);
    expect(() =>
      normalizeThrows(owner, [[]] as unknown as ThrowsDeclaration),
    ).toThrow(/got array/);
    expect(() =>
      normalizeThrows(owner, [123] as unknown as ThrowsDeclaration),
    ).toThrow(/got number/);
  });

  it("works with hook ThrowOwner kind", () => {
    const hookOwner = { kind: "hook" as const, id: "spec-hook" };
    expect(normalizeThrows(hookOwner, [createErrorHelper("err.id")])).toEqual([
      "err.id",
    ]);
  });

  it("works with task-middleware ThrowOwner kind", () => {
    const mwOwner = {
      kind: "task-middleware" as const,
      id: "spec-tmw",
    };
    expect(normalizeThrows(mwOwner, [createErrorHelper("err.id")])).toEqual([
      "err.id",
    ]);
    expect(() =>
      normalizeThrows(mwOwner, ["   "] as ThrowsDeclaration),
    ).toThrow(/Invalid throws entry for task-middleware/);
  });

  it("works with resource-middleware ThrowOwner kind", () => {
    const mwOwner = {
      kind: "resource-middleware" as const,
      id: "spec-rmw",
    };
    expect(normalizeThrows(mwOwner, [createErrorHelper("err.id")])).toEqual([
      "err.id",
    ]);
    expect(() =>
      normalizeThrows(mwOwner, ["   "] as ThrowsDeclaration),
    ).toThrow(/Invalid throws entry for resource-middleware/);
  });

  it("works with event ThrowOwner kind", () => {
    const eventOwner = { kind: "event" as const, id: "spec-event" };
    expect(normalizeThrows(eventOwner, [createErrorHelper("err.id")])).toEqual([
      "err.id",
    ]);
    expect(() =>
      normalizeThrows(eventOwner, ["   "] as ThrowsDeclaration),
    ).toThrow(/Invalid throws entry for event/);
  });
});
