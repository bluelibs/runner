/**
 * Security attack vector tests for Serializer
 *
 * Focus: inputs designed to exhaust memory/time via size.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { Serializer } from "../../serializer/index";

describe("Serializer Security Attacks", () => {
  let serializer: Serializer;

  beforeEach(() => {
    serializer = new Serializer();
  });

  describe("Memory Exhaustion Attacks", () => {
    it("should handle extremely large array lengths gracefully", () => {
      // This creates an array declaration but JSON.parse will handle it
      // The serializer should process it within depth limits
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "obj_1" },
        nodes: {
          obj_1: {
            kind: "array",
            value: new Array(10000).fill(1),
          },
        },
      });

      // Should complete without stack overflow
      const result = serializer.deserialize<number[]>(payload);
      expect(result.length).toBe(10000);
    });

    it("should handle wide objects with many keys", () => {
      const wideObject: Record<string, number> = {};
      for (let i = 0; i < 10000; i++) {
        wideObject[`key_${i}`] = i;
      }

      const payload = JSON.stringify(wideObject);
      const result = serializer.deserialize<Record<string, number>>(payload);

      expect(Object.keys(result).length).toBe(10000);
      expect(result.key_0).toBe(0);
      expect(result.key_9999).toBe(9999);
    });

    it("should fail fast when array node payload is not an actual array", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "obj_1" },
        nodes: {
          obj_1: {
            kind: "array",
            value: { length: 10_000_000 },
          },
        },
      });

      expect(() => serializer.deserialize(payload)).toThrow(
        /Invalid array node payload/,
      );
    });
  });
});
