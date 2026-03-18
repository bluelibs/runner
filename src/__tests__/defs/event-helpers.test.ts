import { defineEvent } from "../../define";
import { onAnyOf, isOneOf } from "../../public";
import type { IEventEmission } from "../../defs";
import { runtimeSource } from "../../types/runtimeSource";
import { symbolDefinitionIdentity } from "../../types/symbols";

describe("event helpers", () => {
  it("returns false for identity-less emissions even when raw ids match", () => {
    const e1 = defineEvent<{ a: string }>({ id: "ev-a" });
    const e2 = defineEvent<{ b: number }>({ id: "ev-b" });

    const emissionA: IEventEmission<{ a: string }> = {
      id: "ev-a",
      data: { a: "x" },
      timestamp: new Date(),
      signal: new AbortController().signal,
      source: runtimeSource.runtime("test"),
      meta: {},
      transactional: false,
      stopPropagation() {},
      isPropagationStopped() {
        return false;
      },
      tags: [],
    };

    expect(isOneOf(emissionA, onAnyOf(e1, e2))).toBe(false);
  });

  it("matches emissions that retain Runner definition identity", () => {
    const event = defineEvent<{ a: string }>({ id: "ev-a" });

    const emission: IEventEmission<{ a: string }> = {
      id: "ev-a",
      data: { a: "x" },
      timestamp: new Date(),
      signal: new AbortController().signal,
      source: runtimeSource.runtime("test"),
      meta: {},
      transactional: false,
      stopPropagation() {},
      isPropagationStopped() {
        return false;
      },
      tags: [],
      [symbolDefinitionIdentity]: ((
        event as unknown as Record<symbol, unknown>
      )[symbolDefinitionIdentity] ?? undefined) as object | undefined,
    };

    expect(isOneOf(emission, onAnyOf(event))).toBe(true);
  });

  it("distinguishes sibling events that share a local id when emissions carry identity", () => {
    const left = defineEvent<{ side: "left" }>({ id: "shared-event" });
    const right = defineEvent<{ side: "right" }>({ id: "shared-event" });

    const rightEmission: IEventEmission<{ side: "right" }> = {
      id: "shared-event",
      data: { side: "right" },
      timestamp: new Date(),
      signal: new AbortController().signal,
      source: runtimeSource.runtime("test"),
      meta: {},
      transactional: false,
      stopPropagation() {},
      isPropagationStopped() {
        return false;
      },
      tags: [],
      [symbolDefinitionIdentity]: ((
        right as unknown as Record<symbol, unknown>
      )[symbolDefinitionIdentity] ?? undefined) as object | undefined,
    };

    expect(isOneOf(rightEmission, onAnyOf(right))).toBe(true);
    expect(isOneOf(rightEmission, onAnyOf(left))).toBe(false);
  });
});
