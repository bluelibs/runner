/**
 * Security attack vector tests for Serializer
 *
 * Focus: reference hijacking and unsafe graph ids.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { Serializer } from "../index";

describe("Serializer Security Attacks", () => {
  let serializer: Serializer;

  beforeEach(() => {
    serializer = new Serializer();
  });

  describe("Reference Hijacking Attacks", () => {
    it("should throw on reference to non-existent node", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "obj_1" },
        nodes: {
          obj_1: {
            kind: "object",
            value: { missing: { __ref: "does_not_exist" } },
          },
        },
      });

      expect(() => serializer.deserialize(payload)).toThrow(
        /Unresolved reference id/,
      );
    });

    it("should reject unsafe reference IDs (__proto__)", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "__proto__" },
        nodes: {
          ["__proto__"]: { kind: "object", value: { polluted: true } },
        },
      });

      expect(() => serializer.deserialize(payload)).toThrow(
        /Unresolved reference id/,
      );
    });

    it("should reject unsafe reference IDs (constructor)", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "constructor" },
        nodes: {
          constructor: { kind: "object", value: { polluted: true } },
        },
      });

      expect(() => serializer.deserialize(payload)).toThrow(
        /Unresolved reference id/,
      );
    });

    it("should reject unsafe reference IDs (prototype)", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "prototype" },
        nodes: {
          prototype: { kind: "object", value: { polluted: true } },
        },
      });

      expect(() => serializer.deserialize(payload)).toThrow(
        /Unresolved reference id/,
      );
    });
  });
});
