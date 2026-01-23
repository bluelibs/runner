/**
 * Security attack vector tests for Serializer
 *
 * Focus: code injection / RCE attempts via type metadata.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { Serializer } from "../../serializer/index";

describe("Serializer Security Attacks", () => {
  let serializer: Serializer;

  beforeEach(() => {
    serializer = new Serializer();
  });

  describe("Code Injection / RCE Attacks", () => {
    it("should not execute code via Function constructor type name", () => {
      const payload = JSON.stringify({
        __type: "Function",
        value: "return process.exit(1)",
      });

      // Should throw "Unknown type", not execute the code
      expect(() => serializer.deserialize(payload)).toThrow(/Unknown type/);
    });

    it("should not execute code via eval-like type name", () => {
      const payload = JSON.stringify({
        __type: "eval",
        value: "process.exit(1)",
      });

      expect(() => serializer.deserialize(payload)).toThrow(/Unknown type/);
    });

    it("should not execute code via require type name", () => {
      const payload = JSON.stringify({
        __type: "require",
        value: "child_process",
      });

      expect(() => serializer.deserialize(payload)).toThrow(/Unknown type/);
    });

    it("should not execute code via process type name", () => {
      const payload = JSON.stringify({
        __type: "process",
        value: { argv: ["node", "evil.js"] },
      });

      expect(() => serializer.deserialize(payload)).toThrow(/Unknown type/);
    });

    it("should not execute code via child_process type name", () => {
      const payload = JSON.stringify({
        __type: "child_process.exec",
        value: "rm -rf /",
      });

      expect(() => serializer.deserialize(payload)).toThrow(/Unknown type/);
    });

    it("should not execute code via Buffer type name with malicious data", () => {
      // Buffer is not a built-in type, so should be rejected
      const payload = JSON.stringify({
        __type: "Buffer",
        value: [0x48, 0x65, 0x6c, 0x6c, 0x6f],
      });

      expect(() => serializer.deserialize(payload)).toThrow(/Unknown type/);
    });

    it("should not be vulnerable to type name with special characters", () => {
      const maliciousTypeNames = [
        "constructor",
        "__proto__",
        "prototype",
        "toString",
        "valueOf",
        "hasOwnProperty",
        "__defineGetter__",
        "__defineSetter__",
        "__lookupGetter__",
        "__lookupSetter__",
      ];

      for (const typeName of maliciousTypeNames) {
        const payload = JSON.stringify({
          __type: typeName,
          value: { evil: true },
        });

        expect(() => serializer.deserialize(payload)).toThrow(/Unknown type/);
      }
    });

    it("should not execute code hidden in type value as code string", () => {
      // Even if Date type is known, the value should be treated as data
      const payload = JSON.stringify({
        __type: "Date",
        value: "require('child_process').exec('whoami')",
      });

      // Date will try to parse this as a date string and return Invalid Date
      const result = serializer.deserialize<Date>(payload);
      expect(result).toBeInstanceOf(Date);
      expect(isNaN(result.getTime())).toBe(true); // Invalid date, not code execution
    });

    it("should not execute code hidden in Map entries", () => {
      const payload = JSON.stringify({
        __type: "Map",
        value: [
          ["cmd", "require('child_process').execSync('whoami')"],
          ["safe", "value"],
        ],
      });

      const result = serializer.deserialize<Map<string, string>>(payload);
      expect(result).toBeInstanceOf(Map);
      // The value is just a string, not evaluated
      expect(result.get("cmd")).toBe(
        "require('child_process').execSync('whoami')",
      );
    });

    it("should not execute code via crafted type with code in graph nodes", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "obj_1" },
        nodes: {
          obj_1: {
            kind: "type",
            type: "Function('return process')().exit(1)",
            value: {},
          },
        },
      });

      expect(() => serializer.deserialize(payload)).toThrow(/Unknown type/);
    });

    it("should not execute __proto__ pollution via type value", () => {
      const originalToString = {}.toString;

      const payload = JSON.stringify({
        __type: "Map",
        value: [
          ["__proto__", { toString: () => "hacked" }],
          ["normal", "value"],
        ],
      });

      const result = serializer.deserialize<Map<string, unknown>>(payload);
      expect(result).toBeInstanceOf(Map);

      // Object.prototype should not be polluted
      expect({}.toString).toBe(originalToString);
    });

    it("should reject type names attempting path traversal", () => {
      const traversalAttempts = [
        "../../../etc/passwd",
        "..\\..\\windows\\system32",
        "/etc/passwd",
        "file:///etc/passwd",
        "node:child_process",
      ];

      for (const typeName of traversalAttempts) {
        const payload = JSON.stringify({
          __type: typeName,
          value: {},
        });

        expect(() => serializer.deserialize(payload)).toThrow(/Unknown type/);
      }
    });

    it("should reject type names with null bytes", () => {
      const payload = JSON.stringify({
        __type: "Date\x00.exec",
        value: "2024-01-01",
      });

      expect(() => serializer.deserialize(payload)).toThrow(/Unknown type/);
    });

    it("should reject type names with unicode tricks", () => {
      const unicodeTricks = [
        "Ｆunction", // Fullwidth F
        "evａl", // Fullwidth a
        "ℱunction", // Script capital F
        "ᴱval", // Superscript E
      ];

      for (const typeName of unicodeTricks) {
        const payload = JSON.stringify({
          __type: typeName,
          value: {},
        });

        expect(() => serializer.deserialize(payload)).toThrow(/Unknown type/);
      }
    });
  });
});
