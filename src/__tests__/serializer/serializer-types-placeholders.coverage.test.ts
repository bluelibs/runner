import { beforeEach, describe, expect, it } from "@jest/globals";
import { Serializer } from "../../serializer/index";
import type { TypeDefinition } from "../../serializer/index";
import { createMessageError } from "../../errors";

describe("Serializer types/placeholders coverage", () => {
  let serializer: Serializer;

  beforeEach(() => {
    serializer = new Serializer();
  });

  describe("Primitive Serialization Edge Cases", () => {
    it("preserves undefined for primitive input", () => {
      const serialized = serializer.serialize(undefined);
      expect(JSON.parse(serialized)).toEqual({
        __type: "Undefined",
        value: null,
      });
      expect(serializer.deserialize(serialized)).toBeUndefined();
    });

    it("should serialize mixed array with supported types", () => {
      const result = serializer.serialize([1, "string", true, null]);
      const deserialized = serializer.deserialize(result);
      expect(deserialized).toEqual([1, "string", true, null]);
    });

    it("serializes bigint primitives", () => {
      const payload = serializer.serialize(BigInt(123));
      expect(serializer.deserialize(payload)).toBe(BigInt(123));
    });

    it("serializes global and well-known symbols, rejects unique symbols", () => {
      const globalSymbol = Symbol.for("coverage.sym");
      const globalPayload = serializer.serialize(globalSymbol);
      expect(serializer.deserialize(globalPayload)).toBe(globalSymbol);

      const wellKnownPayload = serializer.serialize(Symbol.iterator);
      expect(serializer.deserialize(wellKnownPayload)).toBe(Symbol.iterator);

      expect(() => serializer.serialize(Symbol("unique"))).toThrow(
        /unique symbols/i,
      );
    });

    it("should throw TypeError for Function", () => {
      expect(() => {
        serializer.serialize(() => true);
      }).toThrow('Cannot serialize value of type "function"');
    });
  });

  describe("Type exclusion branches (coverage)", () => {
    it("excludes the current type when the serialized payload matches the same type (tree + graph)", () => {
      class SelfType {
        constructor(public value: number) {}
      }

      const selfType: TypeDefinition<SelfType, unknown> = {
        id: "SelfType",
        is: (obj): obj is SelfType => obj instanceof SelfType,
        serialize: (obj) => obj,
        deserialize: (data) => new SelfType((data as any).value),
        strategy: "value",
      };

      serializer.addType(selfType);

      const tree = serializer.stringify(new SelfType(1));
      const treeParsed = serializer.parse<SelfType>(tree);
      expect(treeParsed).toBeInstanceOf(SelfType);
      expect(treeParsed.value).toBe(1);

      const graph = serializer.serialize(new SelfType(2));
      const graphParsed = serializer.deserialize<SelfType>(graph);
      expect(graphParsed).toBeInstanceOf(SelfType);
      expect(graphParsed.value).toBe(2);
    });

    it("handles errors thrown by type guards when checking serialized payload", () => {
      class ThrowingType {}

      const throwing: TypeDefinition<ThrowingType, unknown> = {
        id: "ThrowingType",
        is: (obj: unknown): obj is ThrowingType => {
          if (obj && typeof obj === "object" && (obj as any).trigger === true) {
            throw createMessageError("boom");
          }
          return obj instanceof ThrowingType;
        },
        serialize: () => ({ trigger: true }),
        deserialize: () => new ThrowingType(),
        strategy: "value",
      };

      serializer.addType(throwing);

      const text = serializer.stringify(new ThrowingType());
      const parsed = serializer.parse<ThrowingType>(text);
      expect(parsed).toBeInstanceOf(ThrowingType);
    });

    it("supports self-serializing array-like value types in tree mode", () => {
      class SelfArray extends Array<number> {}

      const selfArrayType: TypeDefinition<SelfArray, unknown> = {
        id: "SelfArray",
        is: (obj): obj is SelfArray => obj instanceof SelfArray,
        serialize: (obj) => obj,
        deserialize: (data) => SelfArray.from(data as number[]),
        strategy: "value",
      };

      serializer.addType(selfArrayType);

      const input = new SelfArray();
      input.push(1, 2);

      const text = serializer.stringify(input);
      const parsed = serializer.parse<SelfArray>(text);
      expect(Array.from(parsed)).toEqual([1, 2]);
    });
  });

  describe("Value Strategy Types", () => {
    it("should inline value types without creating dangling references", () => {
      const reusedDate = new Date("2024-01-01T00:00:00.000Z");
      const text = serializer.serialize({
        first: reusedDate,
        second: reusedDate,
      });
      const parsed = serializer.deserialize<{ first: Date; second: Date }>(
        text,
      );

      expect(parsed.first.getTime()).toBe(reusedDate.getTime());
      expect(parsed.second.getTime()).toBe(reusedDate.getTime());
      expect(parsed.first).not.toBe(parsed.second);
    });
  });

  describe("MergePlaceholder Edge Cases", () => {
    it("should handle placeholder === result case for Date", () => {
      class CustomDate {
        constructor(public date: Date) {}
      }

      const customType: TypeDefinition<CustomDate, string> = {
        id: "CustomDate",
        is: (obj): obj is CustomDate => obj instanceof CustomDate,
        serialize: (obj) => obj.date.toISOString(),
        deserialize: (data) => {
          const instance = new CustomDate(new Date(data));
          return instance;
        },
        create: () => new CustomDate(new Date(0)),
      };

      serializer.addType(customType);

      const obj: { self?: CustomDate; ref?: CustomDate } = {};
      obj.self = new CustomDate(new Date("2024-01-01"));
      obj.ref = obj.self;

      const serialized = serializer.serialize(obj);
      const deserialized = serializer.deserialize<typeof obj>(serialized);

      expect(deserialized.self).toBe(deserialized.ref);
    });

    it("should handle mergePlaceholder fallback for non-matching types", () => {
      class CustomValue {
        constructor(public value: number) {}
      }

      const customType: TypeDefinition<CustomValue, number> = {
        id: "CustomValue",
        is: (obj): obj is CustomValue => obj instanceof CustomValue,
        serialize: (obj) => obj.value,
        deserialize: (data) => new CustomValue(data),
        create: () => new CustomValue(0),
      };

      serializer.addType(customType);

      const obj: { self?: CustomValue; ref?: CustomValue } = {};
      obj.self = new CustomValue(42);
      obj.ref = obj.self;

      const serialized = serializer.serialize(obj);
      const deserialized = serializer.deserialize<typeof obj>(serialized);

      expect(deserialized.self).toBe(deserialized.ref);
      expect(deserialized.self?.value).toBe(42);
    });
  });

  describe("SerializeValue Edge Cases", () => {
    it("should handle undefined values in object contexts", () => {
      const obj = {
        defined: "value",
        nested: {
          inner: undefined as string | undefined,
        },
      };

      const serialized = serializer.serialize(obj);
      const deserialized = serializer.deserialize<typeof obj>(serialized);

      expect(deserialized.defined).toBe("value");
      expect(
        Object.prototype.hasOwnProperty.call(deserialized.nested, "inner"),
      ).toBe(true);
      expect(deserialized.nested.inner).toBeUndefined();
    });

    it("should handle undefined in nested array values", () => {
      const obj = {
        values: [1, undefined, 3] as (number | undefined)[],
      };

      const serialized = serializer.serialize(obj);
      const deserialized = serializer.deserialize<{
        values: (number | undefined)[];
      }>(serialized);

      expect(deserialized.values).toEqual([1, undefined, 3]);
      expect(
        Object.prototype.hasOwnProperty.call(deserialized.values, "1"),
      ).toBe(true);
    });
  });

  describe("MergePlaceholder Fallback", () => {
    it("should use fallback return when deserialize returns null", () => {
      class NullableWrapper {
        value: string | null = null;
      }

      const customType: TypeDefinition<NullableWrapper, string | null> = {
        id: "NullableWrapper",
        is: (obj): obj is NullableWrapper => obj instanceof NullableWrapper,
        serialize: (obj) => obj.value,
        deserialize: (data) => {
          const wrapper = new NullableWrapper();
          wrapper.value = data;
          return wrapper;
        },
        create: () => new NullableWrapper(),
      };

      serializer.addType(customType);

      const wrapper = new NullableWrapper();
      wrapper.value = null;
      const obj = { wrapper };

      const serialized = serializer.serialize(obj);
      const deserialized = serializer.deserialize<typeof obj>(serialized);

      expect(deserialized.wrapper).toBeInstanceOf(NullableWrapper);
      expect(deserialized.wrapper.value).toBe(null);
    });

    it("should use fallback when placeholder is array but result is not", () => {
      class ArrayWrapper {
        items: string[] = [];
      }

      const customType: TypeDefinition<ArrayWrapper, string[]> = {
        id: "ArrayWrapper",
        is: (obj): obj is ArrayWrapper => obj instanceof ArrayWrapper,
        serialize: (obj) => obj.items,
        deserialize: (data) => {
          const wrapper = new ArrayWrapper();
          wrapper.items = data;
          return wrapper;
        },
        create: () => new ArrayWrapper(),
      };

      serializer.addType(customType);

      const wrapper = new ArrayWrapper();
      wrapper.items = ["a", "b"];

      const serialized = serializer.serialize(wrapper);
      const deserialized = serializer.deserialize<ArrayWrapper>(serialized);

      expect(deserialized.items).toEqual(["a", "b"]);
    });
  });

  describe("isSerializedTypeRecord Edge Cases", () => {
    it("should handle falsy values in legacy deserialization", () => {
      const testCases = [0, "", false, null];

      testCases.forEach((value) => {
        const payload = JSON.stringify(value);
        const result = serializer.deserialize(payload);
        expect(result).toBe(value);
      });
    });
  });
});
