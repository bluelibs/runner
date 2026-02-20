import { beforeEach, describe, expect, it } from "@jest/globals";
import { Serializer } from "../../serializer/index";

describe("Serializer tree validation coverage", () => {
  let serializer: Serializer;

  beforeEach(() => {
    serializer = new Serializer();
  });

  describe("Tree Mode & addType Validation Branches", () => {
    it("covers type-registry get() test helper", () => {
      serializer.addType({
        id: "CoverageGet",
        is: (_obj: unknown): _obj is number => typeof _obj === "number",
        serialize: (value) => value,
        deserialize: (value) => value,
        strategy: "value",
      });

      const registry = (serializer as any).typeRegistry as {
        get: (typeId: string) => unknown;
      };
      expect(registry.get("CoverageGet")).toBeDefined();
      expect(registry.get("MissingCoverageGet")).toBeUndefined();
    });

    it("throws for invalid type definitions", () => {
      expect(() => (serializer as any).addType({})).toThrow(
        "Invalid type definition: id is required",
      );

      expect(() =>
        serializer.addType({
          id: "MissingIs",
          is: undefined as any,
          serialize: (value: unknown) => value,
          deserialize: (value: unknown) => value,
        }),
      ).toThrow("Invalid type definition: is is required");

      expect(() =>
        serializer.addType({
          id: "InvalidType",
          is: (_obj: unknown): _obj is unknown => true,
          serialize: undefined as any,
          deserialize: undefined as any,
        }),
      ).toThrow(
        "Invalid type definition: serialize and deserialize are required",
      );
    });

    it("stringify handles undefined, Infinity, and circular objects", () => {
      expect(JSON.parse(serializer.stringify(undefined))).toEqual({
        __type: "Undefined",
        value: null,
      });
      expect(serializer.parse(serializer.stringify(undefined))).toBeUndefined();

      expect(
        JSON.parse(serializer.stringify(Number.POSITIVE_INFINITY)),
      ).toEqual({
        __type: "NonFiniteNumber",
        value: "Infinity",
      });
      expect(
        serializer.parse(serializer.stringify(Number.POSITIVE_INFINITY)),
      ).toBe(Number.POSITIVE_INFINITY);

      const obj: any = {};
      obj.self = obj;
      expect(() => serializer.stringify(obj)).toThrow("circular");

      const selfMap = new Map<string, unknown>();
      selfMap.set("self", selfMap);
      expect(() => serializer.stringify(selfMap)).toThrow("circular");
    });

    it("stringify rejects unsupported JS primitives in tree mode", () => {
      expect(serializer.parse(serializer.stringify(BigInt(1)))).toBe(BigInt(1));

      expect(serializer.parse(serializer.stringify(Symbol.for("x")))).toBe(
        Symbol.for("x"),
      );
      expect(serializer.parse(serializer.stringify(Symbol.iterator))).toBe(
        Symbol.iterator,
      );
      expect(() => serializer.stringify(Symbol("x"))).toThrow(
        /unique symbols/i,
      );
      expect(() => serializer.stringify(() => true)).toThrow(
        'Cannot serialize value of type "function"',
      );
    });

    it("jsonStringify rejects unsupported JS primitives", () => {
      const jsonStringify = (serializer as any).jsonStringify as (
        value: unknown,
      ) => string;

      expect(() => jsonStringify(BigInt(1))).toThrow(
        'Cannot stringify value of type "bigint"',
      );
      expect(() => jsonStringify(Symbol("x"))).toThrow(
        'Cannot stringify value of type "symbol"',
      );
      expect(() => jsonStringify(() => true)).toThrow(
        'Cannot stringify value of type "function"',
      );
    });
  });
});
