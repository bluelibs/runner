import { describe, it, expect } from "@jest/globals";
import { Serializer, SymbolPolicyErrorMessage } from "../../serializer/index";
import type { SymbolPolicy } from "../../serializer/types";
import { SpecialTypeId } from "../../serializer/special-values";
import { SymbolPayloadKind } from "../../serializer/builtins";

describe("Serializer Symbol Policy", () => {
  it("fails fast for unsupported symbol policies", () => {
    // Forced cast to simulate invalid runtime input.
    const invalidPolicy = "invalid" as unknown as SymbolPolicy;

    expect(() => new Serializer({ symbolPolicy: invalidPolicy })).toThrow(
      SymbolPolicyErrorMessage.UnsupportedSymbolPolicy,
    );
  });

  it("rejects global symbols when policy is well-known-only", () => {
    const serializer = new Serializer({
      symbolPolicy: "well-known-only",
    });
    const payload = JSON.stringify({
      __type: SpecialTypeId.Symbol,
      value: { kind: SymbolPayloadKind.For, key: "deny" },
    });

    expect(() => serializer.deserialize(payload)).toThrow(
      SymbolPolicyErrorMessage.GlobalSymbolsNotAllowed,
    );
  });

  it("allows well-known symbols when policy is well-known-only", () => {
    const serializer = new Serializer({
      symbolPolicy: "well-known-only",
    });
    const payload = JSON.stringify({
      __type: SpecialTypeId.Symbol,
      value: { kind: SymbolPayloadKind.WellKnown, key: "iterator" },
    });

    expect(serializer.deserialize(payload)).toBe(Symbol.iterator);
  });

  it("rejects all symbols when policy is disabled", () => {
    const serializer = new Serializer({
      symbolPolicy: "disabled",
    });
    const payload = JSON.stringify({
      __type: SpecialTypeId.Symbol,
      value: { kind: SymbolPayloadKind.WellKnown, key: "iterator" },
    });

    expect(() => serializer.deserialize(payload)).toThrow(
      SymbolPolicyErrorMessage.SymbolsNotAllowed,
    );
  });
});
