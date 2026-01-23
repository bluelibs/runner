import { describe, it, expect } from "@jest/globals";
import { Serializer } from "../../serializer/index";
import { SpecialTypeId } from "../../serializer/special-values";
import { BigIntType, SymbolPayloadKind } from "../../serializer/builtins";
import {
  assertBigIntPayload,
  serializeBigIntPayload,
  serializeBigInt,
} from "../../serializer/special-values";

describe("Serializer BigInt/Symbol payload validation", () => {
  it("encodes bigint via BigIntType.serialize", () => {
    expect(BigIntType.serialize(BigInt(123))).toBe("123");
  });

  it("encodes bigint payload via serializeBigIntPayload", () => {
    expect(serializeBigIntPayload(BigInt(123))).toBe("123");
  });

  it("encodes bigint typed record via serializeBigInt", () => {
    expect(serializeBigInt(BigInt(123))).toEqual({
      __type: SpecialTypeId.BigInt,
      value: "123",
    });
  });

  it("accepts bigint payloads via assertBigIntPayload", () => {
    expect(assertBigIntPayload("123")).toBe("123");
  });

  it("throws on invalid bigint payloads", () => {
    const serializer = new Serializer();
    const payload = JSON.stringify({
      __type: SpecialTypeId.BigInt,
      value: 123,
    });

    expect(() => serializer.deserialize(payload)).toThrow(/bigint payload/i);
    expect(() => assertBigIntPayload(123)).toThrow(/bigint payload/i);
  });

  it("throws on invalid symbol payloads (shape validation)", () => {
    const serializer = new Serializer();

    expect(() =>
      serializer.deserialize(
        JSON.stringify({ __type: SpecialTypeId.Symbol, value: 123 }),
      ),
    ).toThrow(/invalid symbol payload/i);

    expect(() =>
      serializer.deserialize(
        JSON.stringify({
          __type: SpecialTypeId.Symbol,
          value: { kind: SymbolPayloadKind.For, key: 1 },
        }),
      ),
    ).toThrow(/invalid symbol payload/i);

    expect(() =>
      serializer.deserialize(
        JSON.stringify({
          __type: SpecialTypeId.Symbol,
          value: { kind: SymbolPayloadKind.WellKnown, key: 1 },
        }),
      ),
    ).toThrow(/invalid symbol payload/i);

    expect(() =>
      serializer.deserialize(
        JSON.stringify({
          __type: SpecialTypeId.Symbol,
          value: { kind: SymbolPayloadKind.WellKnown, key: "notAWellKnownKey" },
        }),
      ),
    ).toThrow(/invalid symbol payload/i);

    expect(() =>
      serializer.deserialize(
        JSON.stringify({
          __type: SpecialTypeId.Symbol,
          value: { kind: "Nope", key: "x" },
        }),
      ),
    ).toThrow(/invalid symbol payload/i);
  });

  it("throws on unsupported well-known symbol keys", () => {
    const serializer = new Serializer();
    // Ensure a clean baseline in case another suite defines it.
    // Symbol properties created by userland are configurable by default.
    const symbolObject = Symbol as unknown as Record<string, unknown>;
    delete symbolObject.observable;

    expect(() =>
      serializer.deserialize(
        JSON.stringify({
          __type: SpecialTypeId.Symbol,
          value: { kind: SymbolPayloadKind.WellKnown, key: "observable" },
        }),
      ),
    ).toThrow(/unsupported well-known symbol/i);
  });

  it("fails fast if the symbol built-in type is removed from the registry", () => {
    const serializer = new Serializer();

    const registry = (serializer as unknown as { typeRegistry: unknown })
      .typeRegistry as unknown as {
      typeRegistry: Map<string, unknown>;
      refreshTypeCache: () => void;
    };

    registry.typeRegistry.delete(SpecialTypeId.Symbol);
    registry.refreshTypeCache();

    expect(() => serializer.serialize(Symbol.for("x"))).toThrow(
      /Cannot serialize value of type "symbol"/,
    );
    expect(() => serializer.stringify(Symbol.for("x"))).toThrow(
      /Cannot serialize value of type "symbol"/,
    );
  });
});
