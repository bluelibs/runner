import { defineEvent } from "../define";
import { isOneOf, onAnyOf, IEventEmission } from "../defs";

describe("event helpers", () => {
  it("onAnyOf returns the same tuple of definitions", () => {
    const e1 = defineEvent<{ a: string }>({ id: "ev.a" });
    const e2 = defineEvent<{ b: number }>({ id: "ev.b" });

    const tuple = onAnyOf(e1, e2);
    expect(Array.isArray(tuple)).toBe(true);
    expect(tuple.length).toBe(2);
    expect(tuple[0].id).toBe("ev.a");
    expect(tuple[1].id).toBe("ev.b");
  });

  it("isOneOf checks membership by id", () => {
    const e1 = defineEvent<{ a: string }>({ id: "ev.a" });
    const e2 = defineEvent<{ b: number }>({ id: "ev.b" });

    const emissionA: IEventEmission<{ a: string }> = {
      id: "ev.a",
      data: { a: "x" },
      timestamp: new Date(),
      source: "test",
      meta: {},
      stopPropagation() {},
      isPropagationStopped() {
        return false;
      },
      tags: [],
    };

    const emissionC: IEventEmission<{ c: boolean }> = {
      id: "ev.c",
      data: { c: true },
      timestamp: new Date(),
      source: "test",
      meta: {},
      stopPropagation() {},
      isPropagationStopped() {
        return false;
      },
      tags: [],
    };

    expect(isOneOf(emissionA, onAnyOf(e1, e2))).toBe(true);
    expect(isOneOf(emissionC, onAnyOf(e1, e2))).toBe(false);
  });
});
