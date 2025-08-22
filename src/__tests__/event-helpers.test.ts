import { defineEvent } from "../define";
import { isOneOf, IEventEmission } from "../defs";

describe("event helpers", () => {
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
