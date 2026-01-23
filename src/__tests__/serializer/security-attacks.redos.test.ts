/**
 * Security attack vector tests for Serializer
 *
 * Focus: ReDoS vectors using RegExp payloads.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { Serializer } from "../../serializer/index";

describe("Serializer Security Attacks", () => {
  let serializer: Serializer;

  beforeEach(() => {
    serializer = new Serializer();
  });

  describe("ReDoS (Regular Expression DoS) Attacks", () => {
    it("should reject overly long RegExp patterns", () => {
      const longPattern = "a".repeat(2000);
      const payload = JSON.stringify({
        __type: "RegExp",
        value: { pattern: longPattern, flags: "" },
      });

      expect(() => serializer.deserialize(payload)).toThrow();
    });

    it("should allow safe RegExp patterns", () => {
      const payload = JSON.stringify({
        __type: "RegExp",
        value: { pattern: "test", flags: "gi" },
      });

      const result = serializer.deserialize<RegExp>(payload);
      expect(result).toBeInstanceOf(RegExp);
      expect(result.source).toBe("test");
    });

    it("should detect unsafe nested quantifiers by default", () => {
      // Patterns like (a+)+ can cause catastrophic backtracking
      const unsafePattern = "(a+)+";
      expect(serializer.isRegExpPatternSafe(unsafePattern)).toBe(false);
    });

    it("should allow configuring max RegExp pattern length", () => {
      const strictSerializer = new Serializer({ maxRegExpPatternLength: 10 });
      const payload = JSON.stringify({
        __type: "RegExp",
        value: { pattern: "a".repeat(15), flags: "" },
      });

      expect(() => strictSerializer.deserialize(payload)).toThrow();
    });
  });
});
