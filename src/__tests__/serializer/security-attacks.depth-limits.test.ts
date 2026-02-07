/**
 * Security attack vector tests for Serializer
 *
 * Focus: depth limits and maxDepth edge cases.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { Serializer } from "../../serializer/index";

describe("Serializer Security Attacks", () => {
  let serializer: Serializer;

  beforeEach(() => {
    serializer = new Serializer();
  });

  describe("Infinite Recursion Attacks", () => {
    it("should reject deeply nested objects exceeding max depth", () => {
      // Create payload with very deep nesting
      let nested = '{"a":1}';
      for (let i = 0; i < 1100; i++) {
        nested = `{"level":${nested}}`;
      }

      expect(() => serializer.deserialize(nested)).toThrow(
        /Maximum depth exceeded/,
      );
    });

    it("should reject deeply nested arrays exceeding max depth", () => {
      // Create payload with very deep array nesting
      let nested = "[1]";
      for (let i = 0; i < 1100; i++) {
        nested = `[${nested}]`;
      }

      expect(() => serializer.deserialize(nested)).toThrow(
        /Maximum depth exceeded/,
      );
    });

    it("should reject graph payloads with deep reference chains exceeding depth", () => {
      // Create a chain of 1100 nodes
      const nodes: Record<string, unknown> = {};
      for (let i = 1; i <= 1100; i++) {
        nodes[`obj_${i}`] = {
          kind: "object",
          value: i < 1100 ? { next: { __ref: `obj_${i + 1}` } } : { end: true },
        };
      }

      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "obj_1" },
        nodes,
      });

      expect(() => serializer.deserialize(payload)).toThrow(
        /Maximum depth exceeded/,
      );
    });

    it("should handle custom max depth configuration", () => {
      const restrictedSerializer = new Serializer({ maxDepth: 5 });
      let nested = '{"a":1}';
      for (let i = 0; i < 10; i++) {
        nested = `{"level":${nested}}`;
      }

      expect(() => restrictedSerializer.deserialize(nested)).toThrow(
        /Maximum depth exceeded \(5\)/,
      );
    });
  });

  describe("Edge Case Resource Limits", () => {
    it("should respect maxDepth of 0", () => {
      const zeroDepthSerializer = new Serializer({ maxDepth: 0 });

      // Even a simple object should fail at depth 0
      expect(() => zeroDepthSerializer.deserialize('{"a":1}')).toThrow(
        /Maximum depth exceeded/,
      );
    });

    it("should handle negative maxDepth as default", () => {
      // Negative values should use default
      const serializer = new Serializer({ maxDepth: -5 });

      // Should use default 1000, so this should work
      const payload = JSON.stringify({ a: { b: { c: 1 } } });
      const result = serializer.deserialize<{ a: { b: { c: number } } }>(
        payload,
      );
      expect(result.a.b.c).toBe(1);
    });

    it("should allow Infinity maxDepth as unlimited depth", () => {
      const infiniteDepthSerializer = new Serializer({
        maxDepth: Number.POSITIVE_INFINITY,
      });

      let nested = '{"end":true}';
      for (let i = 0; i < 1100; i++) {
        nested = `{"level":${nested}}`;
      }

      const result =
        infiniteDepthSerializer.deserialize<Record<string, unknown>>(nested);
      expect(result).toBeDefined();
    });
  });
});
