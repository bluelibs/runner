import { describe, it, expect } from "@jest/globals";
import { Serializer, SymbolPolicy, SymbolPolicyErrorMessage } from "../index";
import { SpecialTypeId } from "../special-values";
import { SymbolPayloadKind } from "../builtins";

describe("Serializer Symbol Policy", () => {
  it("fails fast for unsupported symbol policies", () => {
    // Forced cast to simulate invalid runtime input.
    const invalidPolicy = "invalid" as unknown as SymbolPolicy;

    expect(() => new Serializer({ symbolPolicy: invalidPolicy })).toThrow(
      SymbolPolicyErrorMessage.UnsupportedSymbolPolicy,
    );
  });

  it("rejects global symbols when policy is WellKnownOnly", () => {
    const serializer = new Serializer({
      symbolPolicy: SymbolPolicy.WellKnownOnly,
    });
    const payload = JSON.stringify({
      __type: SpecialTypeId.Symbol,
      value: { kind: SymbolPayloadKind.For, key: "deny" },
    });

    expect(() => serializer.deserialize(payload)).toThrow(
      SymbolPolicyErrorMessage.GlobalSymbolsNotAllowed,
    );
  });

  it("allows well-known symbols when policy is WellKnownOnly", () => {
    const serializer = new Serializer({
      symbolPolicy: SymbolPolicy.WellKnownOnly,
    });
    const payload = JSON.stringify({
      __type: SpecialTypeId.Symbol,
      value: { kind: SymbolPayloadKind.WellKnown, key: "iterator" },
    });

    expect(serializer.deserialize(payload)).toBe(Symbol.iterator);
  });

  it("rejects all symbols when policy is Disabled", () => {
    const serializer = new Serializer({
      symbolPolicy: SymbolPolicy.Disabled,
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
