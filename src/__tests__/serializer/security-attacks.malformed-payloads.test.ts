/**
 * Security attack vector tests for Serializer
 *
 * Focus: malformed payload handling and fallback behavior.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { Serializer } from "../../serializer/index";

describe("Serializer Security Attacks", () => {
  let serializer: Serializer;

  beforeEach(() => {
    serializer = new Serializer();
  });

  describe("Malformed Payload Attacks", () => {
    it("should handle invalid JSON gracefully", () => {
      expect(() => serializer.deserialize("{invalid json}")).toThrow(
        /Invalid JSON payload/,
      );
    });

    it("should handle missing graph root", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        nodes: {
          obj_1: { kind: "object", value: {} },
        },
      });

      // Missing root should fall through to legacy handling
      const result = serializer.deserialize<{
        __graph: boolean;
        version: number;
        nodes: unknown;
      }>(payload);
      expect(result.__graph).toBe(true);
    });

    it("should handle null nodes in graph payload", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { a: 1 },
        nodes: null,
      });

      // Should fall through to legacy handling since nodes is null
      const result = serializer.deserialize<Record<string, unknown>>(payload);
      expect(result.__graph).toBe(true);
    });

    it("should handle empty nodes object", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { value: "inline" },
        nodes: {},
      });

      const result = serializer.deserialize<{ value: string }>(payload);
      expect(result.value).toBe("inline");
    });

    it("should handle graph with primitive root", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: 42,
        nodes: {},
      });

      const result = serializer.deserialize<number>(payload);
      expect(result).toBe(42);
    });

    it("should reject object nodes with invalid non-object payloads", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "obj_1" },
        nodes: {
          obj_1: {
            kind: "object",
            value: 123,
          },
        },
      });

      expect(() => serializer.deserialize(payload)).toThrow(
        /Invalid object node payload/,
      );
    });
  });
});
