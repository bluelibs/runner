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

    it("should reject invalid RegExp flags", () => {
      const payload = JSON.stringify({
        __type: "RegExp",
        value: { pattern: "test", flags: "xyz" },
      });

      expect(() => serializer.deserialize(payload)).toThrow(
        /Invalid RegExp flags/,
      );
    });

    it("should detect unsafe nested quantifiers by default", () => {
      // Patterns like (a+)+ can cause catastrophic backtracking
      const unsafePattern = "(a+)+";
      expect(serializer.isRegExpPatternSafe(unsafePattern)).toBe(false);
    });

    it("should detect ambiguous quantified alternation patterns", () => {
      expect(serializer.isRegExpPatternSafe("^(a|aa)+$")).toBe(false);

      const payload = JSON.stringify({
        __type: "RegExp",
        value: { pattern: "^(a|aa)+$", flags: "" },
      });

      expect(() => serializer.deserialize(payload)).toThrow(
        /Unsafe RegExp pattern/,
      );
    });

    it("should allow safe alternation patterns", () => {
      expect(serializer.isRegExpPatternSafe("(ab|cd)+")).toBe(true);

      const payload = JSON.stringify({
        __type: "RegExp",
        value: { pattern: "(ab|cd)+", flags: "i" },
      });

      const result = serializer.deserialize<RegExp>(payload);
      expect(result).toBeInstanceOf(RegExp);
      expect(result.source).toBe("(ab|cd)+");
      expect(result.flags).toBe("i");
    });

    it("should allow configuring max RegExp pattern length", () => {
      const strictSerializer = new Serializer({ maxRegExpPatternLength: 10 });
      const payload = JSON.stringify({
        __type: "RegExp",
        value: { pattern: "a".repeat(15), flags: "" },
      });

      expect(() => strictSerializer.deserialize(payload)).toThrow();
    });

    it("should allow unsafe patterns when explicitly configured", () => {
      const permissive = new Serializer({ allowUnsafeRegExp: true });
      const payload = JSON.stringify({
        __type: "RegExp",
        value: { pattern: "^(a|aa)+$", flags: "" },
      });

      const result = permissive.deserialize<RegExp>(payload);
      expect(result).toBeInstanceOf(RegExp);
      expect(result.source).toBe("^(a|aa)+$");
    });
  });
});
