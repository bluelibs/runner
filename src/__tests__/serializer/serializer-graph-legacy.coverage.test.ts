import { beforeEach, describe, expect, it } from "@jest/globals";
import { Serializer } from "../../serializer/index";
import type { TypeDefinition } from "../../serializer/index";

describe("Serializer graph/legacy coverage", () => {
  let serializer: Serializer;

  beforeEach(() => {
    serializer = new Serializer();
  });

  describe("GraphPayload Detection", () => {
    it("should fall back to legacy deserialization for non-graph objects", () => {
      const legacyPayload = JSON.stringify({
        key: "value",
        nested: { inner: 42 },
      });
      const result = serializer.deserialize(legacyPayload);
      expect(result).toEqual({ key: "value", nested: { inner: 42 } });
    });

    it("should fall back to legacy deserialization if __graph is not true", () => {
      const invalidPayload = JSON.stringify({
        __graph: false,
        root: {},
        nodes: {},
      });
      const result = serializer.deserialize(invalidPayload);
      expect(result).toEqual({
        __graph: false,
        root: {},
        nodes: {},
      });
    });

    it("should fall back if root is missing", () => {
      const invalidPayload = JSON.stringify({
        __graph: true,
        nodes: {},
      });
      const result = serializer.deserialize(invalidPayload);
      expect(result).toEqual({
        __graph: true,
        nodes: {},
      });
    });

    it("should fall back if nodes are missing or not an object", () => {
      const invalidPayload = JSON.stringify({
        __graph: true,
        root: {},
        nodes: null,
      });
      const result = serializer.deserialize(invalidPayload);
      expect(result).toEqual({
        __graph: true,
        root: {},
        nodes: null,
      });
    });

    it("should deserialize graph payloads regardless of version for now", () => {
      const invalidPayload = JSON.stringify({
        __graph: true,
        version: 2,
        root: {},
        nodes: {},
      });
      expect(serializer.deserialize(invalidPayload)).toEqual({});
    });
  });

  describe("Reference Resolution", () => {
    it("should throw error for unresolved reference ID", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "missing_id" },
        nodes: {},
      });

      expect(() => {
        serializer.deserialize(payload);
      }).toThrow('Unresolved reference id "missing_id"');
    });

    it("should throw error for unsupported node kind", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "obj_1" },
        nodes: {
          obj_1: { kind: "unknown_kind", value: {} },
        },
      });

      expect(() => {
        serializer.deserialize(payload);
      }).toThrow("Unsupported node kind");
    });

    it("should throw error for unknown type during resolution", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "obj_1" },
        nodes: {
          obj_1: { kind: "type", type: "MissingType", value: {} },
        },
      });

      expect(() => {
        serializer.deserialize(payload);
      }).toThrow("Unknown type: MissingType");
    });
  });

  describe("Legacy Deserialization", () => {
    it("should deserialize legacy arrays", () => {
      const legacyPayload = JSON.stringify([1, 2, 3, "test", true]);
      const result = serializer.deserialize(legacyPayload);
      expect(result).toEqual([1, 2, 3, "test", true]);
    });

    it("should deserialize legacy plain objects", () => {
      const legacyPayload = JSON.stringify({
        name: "test",
        value: 42,
        nested: { inner: "data" },
      });
      const result = serializer.deserialize(legacyPayload);
      expect(result).toEqual({
        name: "test",
        value: 42,
        nested: { inner: "data" },
      });
    });

    it("should deserialize legacy typed objects", () => {
      class CustomClass {
        constructor(public value: string) {}
      }

      const customType: TypeDefinition<CustomClass, { value: string }> = {
        id: "CustomClass",
        is: (obj): obj is CustomClass => obj instanceof CustomClass,
        serialize: (obj) => ({ value: obj.value }),
        deserialize: (data) => new CustomClass(data.value),
      };

      serializer.addType(customType);

      const legacyPayload = JSON.stringify({
        __type: "CustomClass",
        value: { value: "test data" },
      });

      const result = serializer.deserialize<CustomClass>(legacyPayload);
      expect(result).toBeInstanceOf(CustomClass);
      expect(result.value).toBe("test data");
    });

    it("should handle non-typed legacy records", () => {
      const legacyPayload = JSON.stringify({
        notAType: "test",
        value: 42,
      });
      const result = serializer.deserialize(legacyPayload);
      expect(result).toEqual({
        notAType: "test",
        value: 42,
      });
    });

    it("preserves literal __type objects during stringify/parse round-trip", () => {
      const original = {
        literal: {
          __type: "Date",
          value: "not-a-real-date",
        },
      };

      const text = serializer.stringify(original);
      const decoded = serializer.parse<typeof original>(text);

      expect(decoded).toEqual(original);
      const encoded = JSON.parse(text) as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(encoded, "__type")).toBe(
        false,
      );
    });

    it("preserves literal __graph keys during stringify/parse round-trip", () => {
      const original = {
        __graph: true,
        root: { value: 1 },
        nodes: { anything: "goes" },
      };

      const text = serializer.stringify(original);
      const decoded = serializer.parse<typeof original>(text);

      expect(decoded).toEqual(original);
      const encoded = JSON.parse(text) as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(encoded, "__graph")).toBe(
        false,
      );
    });
  });

  describe("DeserializeValue Edge Cases", () => {
    it("should deserialize arrays in non-graph payloads", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: [1, 2, 3],
        nodes: {},
      });

      const result = serializer.deserialize(payload);
      expect(result).toEqual([1, 2, 3]);
    });

    it("should deserialize plain objects in non-graph payloads", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { key: "value", nested: { inner: 42 } },
        nodes: {},
      });

      const result = serializer.deserialize(payload);
      expect(result).toEqual({ key: "value", nested: { inner: 42 } });
    });
  });
});
