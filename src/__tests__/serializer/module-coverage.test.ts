/**
 * Coverage tests for extracted serializer modules.
 * These tests ensure 100% coverage of the new module structure.
 */

import { describe, it, expect } from "@jest/globals";
import {
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
import { SymbolPolicy } from "../../serializer/types";

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

    it("escapes and unescapes reserved serializer marker keys", () => {
      const escapedType = escapeReservedMarkerKey("__type");
      const escapedGraph = escapeReservedMarkerKey("__graph");
      const escapedPrefixed = escapeReservedMarkerKey("$runner.escape::__type");
      const unchanged = escapeReservedMarkerKey("regular");

      expect(escapedType).toBe("$runner.escape::__type");
      expect(escapedGraph).toBe("$runner.escape::__graph");
      expect(escapedPrefixed).toBe("$runner.escape::$runner.escape::__type");
      expect(unchanged).toBe("regular");

      expect(unescapeReservedMarkerKey(escapedType)).toBe("__type");
      expect(unescapeReservedMarkerKey(escapedGraph)).toBe("__graph");
      expect(unescapeReservedMarkerKey(escapedPrefixed)).toBe(
        "$runner.escape::__type",
      );
      expect(unescapeReservedMarkerKey("regular")).toBe("regular");
    });
  });

  describe("type-registry.ts", () => {
    it("getTypeList returns the list of registered types", () => {
      // Covers the getTypeList method on lines 45-46
      const registry = new TypeRegistry({
        allowedTypes: null,
        regExpValidator: { maxPatternLength: 1024, allowUnsafe: false },
        symbolPolicy: SymbolPolicy.AllowAll,
      });

      const typeList = registry.getTypeList();
      expect(Array.isArray(typeList)).toBe(true);
      expect(typeList.length).toBeGreaterThan(0);
      // Should have built-in types like Date, RegExp, etc.
      const typeIds = typeList.map((t) => t.id);
      expect(typeIds).toContain("Date");
      expect(typeIds).toContain("RegExp");
    });
  });

  describe("deserializer.ts", () => {
    it("skips inherited keys in legacy object deserialization", () => {
      const registry = new TypeRegistry({
        allowedTypes: null,
        regExpValidator: { maxPatternLength: 1024, allowUnsafe: false },
        symbolPolicy: SymbolPolicy.AllowAll,
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
