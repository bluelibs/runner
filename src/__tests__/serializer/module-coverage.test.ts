/**
 * Coverage tests for extracted serializer modules.
 * These tests ensure 100% coverage of the new module structure.
 */

import { describe, it, expect } from "@jest/globals";
import {
  isJsonObjectReference,
  isObjectReference,
  isUnsafeKey,
  toNodeRecord,
} from "../../serializer/validation";
import {
  escapeReservedMarkerKey,
  unescapeReservedMarkerKey,
} from "../../serializer/marker-key-escapes";
import { TypeRegistry } from "../../serializer/type-registry";
import { deserializeLegacy } from "../../serializer/deserializer";

describe("Serializer Module Coverage", () => {
  describe("validation.ts", () => {
    it("isUnsafeKey uses DEFAULT_UNSAFE_KEYS when no second argument", () => {
      // Covers the default parameter branch on line 20
      expect(isUnsafeKey("__proto__")).toBe(true);
      expect(isUnsafeKey("constructor")).toBe(true);
      expect(isUnsafeKey("safeKey")).toBe(false);
    });

    it("toNodeRecord uses DEFAULT_UNSAFE_KEYS when no second argument", () => {
      // Covers the default parameter branch on line 86
      const nodes = {
        safe: { kind: "object" as const, value: {} },
      };
      const result = toNodeRecord(nodes as any);
      expect(result.safe).toBeDefined();
    });

    it("isObjectReference requires strict canonical reference shape", () => {
      expect(isObjectReference({ __ref: "obj_1" })).toBe(true);
      expect(isObjectReference({ __ref: "obj_1", extra: true })).toBe(false);

      const withSymbol = { __ref: "obj_1" } as Record<PropertyKey, unknown>;
      withSymbol[Symbol.for("meta")] = true;
      expect(isObjectReference(withSymbol)).toBe(false);
    });

    it("isJsonObjectReference validates JSON reference records without allocations", () => {
      expect(isJsonObjectReference(null)).toBe(false);
      expect(isJsonObjectReference("obj_1")).toBe(false);
      expect(isJsonObjectReference({})).toBe(false);
      expect(isJsonObjectReference({ __ref: 123 })).toBe(false);
      expect(isJsonObjectReference(Object.create({ __ref: "obj_1" }))).toBe(
        false,
      );
      expect(isJsonObjectReference({ __ref: "obj_1", extra: true })).toBe(
        false,
      );
      expect(
        isJsonObjectReference(
          Object.assign(Object.create({ inherited: true }), {
            __ref: "obj_1",
          }),
        ),
      ).toBe(true);
      expect(isJsonObjectReference({ __ref: "obj_1" })).toBe(true);
    });

    it("escapes and unescapes reserved serializer marker keys", () => {
      const escapedType = escapeReservedMarkerKey("__type");
      const escapedGraph = escapeReservedMarkerKey("__graph");
      const escapedPrefixed = escapeReservedMarkerKey("$runner.escape::__type");
      const unchangedUnderscore = escapeReservedMarkerKey("_regular");
      const unchangedDollar = escapeReservedMarkerKey("$regular");
      const unchanged = escapeReservedMarkerKey("regular");

      expect(escapedType).toBe("$runner.escape::__type");
      expect(escapedGraph).toBe("$runner.escape::__graph");
      expect(escapedPrefixed).toBe("$runner.escape::$runner.escape::__type");
      expect(unchangedUnderscore).toBe("_regular");
      expect(unchangedDollar).toBe("$regular");
      expect(unchanged).toBe("regular");

      expect(unescapeReservedMarkerKey(escapedType)).toBe("__type");
      expect(unescapeReservedMarkerKey(escapedGraph)).toBe("__graph");
      expect(unescapeReservedMarkerKey(escapedPrefixed)).toBe(
        "$runner.escape::__type",
      );
      expect(unescapeReservedMarkerKey("$regular")).toBe("$regular");
      expect(unescapeReservedMarkerKey("regular")).toBe("regular");
    });
  });

  describe("type-registry.ts", () => {
    it("getTypeList returns the list of registered types", () => {
      // Covers the getTypeList method on lines 45-46
      const registry = new TypeRegistry({
        allowedTypes: null,
        regExpValidator: { maxPatternLength: 1024, allowUnsafe: false },
        symbolPolicy: "allow-all",
      });

      const typeList = registry.getTypeList();
      expect(Array.isArray(typeList)).toBe(true);
      expect(typeList.length).toBeGreaterThan(0);
      // Should have built-in types like Date, RegExp, etc.
      const typeIds = typeList.map((t) => t.id);
      expect(typeIds).toContain("Date");
      expect(typeIds).toContain("RegExp");
    });

    it("preserves custom type order, exclusions, and built-in precedence", () => {
      const registry = new TypeRegistry({
        allowedTypes: null,
        regExpValidator: { maxPatternLength: 1024, allowUnsafe: false },
        symbolPolicy: "allow-all",
      });
      const unusualPrototype = new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error("No prototype access");
          },
        },
      );
      const guardedDefinition = {
        id: "Guarded",
        is: (value: unknown): value is object =>
          typeof value === "object" && value !== null,
        serialize: () => null,
        deserialize: () => ({}),
      };
      const fallbackDefinition = { ...guardedDefinition, id: "Fallback" };
      registry.addType(guardedDefinition);
      registry.addType(fallbackDefinition);

      expect(registry.findTypeDefinition({}, [])).toBe(guardedDefinition);
      expect(registry.findTypeDefinition([], [])).toBe(guardedDefinition);
      expect(registry.findTypeDefinition(unusualPrototype, ["Guarded"])).toBe(
        fallbackDefinition,
      );
      expect(registry.findTypeDefinition(new Date(0), [])?.id).toBe("Date");
    });
  });

  describe("deserializer.ts", () => {
    it("skips inherited keys in legacy object deserialization", () => {
      const registry = new TypeRegistry({
        allowedTypes: null,
        regExpValidator: { maxPatternLength: 1024, allowUnsafe: false },
        symbolPolicy: "allow-all",
      });

      const source = Object.create({ inherited: 1 }) as Record<string, unknown>;
      source.own = 2;

      const result = deserializeLegacy(source, 0, {
        maxDepth: 1000,
        unsafeKeys: new Set(),
        typeRegistry: registry,
      }) as Record<string, unknown>;

      expect(result).toEqual({ own: 2 });
      expect(result.inherited).toBeUndefined();
    });
  });
});
