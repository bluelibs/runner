/**
 * Coverage tests for extracted serializer modules.
 * These tests ensure 100% coverage of the new module structure.
 */

import { describe, it, expect } from "@jest/globals";
import { isUnsafeKey, toNodeRecord } from "../validation";
import { TypeRegistry } from "../type-registry";
import { deserializeLegacy } from "../deserializer";

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
  });

  describe("type-registry.ts", () => {
    it("getTypeList returns the list of registered types", () => {
      // Covers the getTypeList method on lines 45-46
      const registry = new TypeRegistry({
        allowedTypes: null,
        regExpValidator: { maxPatternLength: 1024, allowUnsafe: false },
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
