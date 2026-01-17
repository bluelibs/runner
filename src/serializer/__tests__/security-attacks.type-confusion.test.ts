/**
 * Security attack vector tests for Serializer
 *
 * Focus: type confusion via malformed graph/type records.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { Serializer } from "../index";

describe("Serializer Security Attacks", () => {
  let serializer: Serializer;

  beforeEach(() => {
    serializer = new Serializer();
  });

  describe("Type Confusion Attacks", () => {
    it("should throw on unknown type during deserialization", () => {
      const payload = JSON.stringify({
        __type: "MaliciousType",
        value: { evil: true },
      });

      expect(() => serializer.deserialize(payload)).toThrow(/Unknown type/);
    });

    it("should reject unknown type in graph nodes", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "obj_1" },
        nodes: {
          obj_1: {
            kind: "type",
            type: "EvilType",
            value: { data: "malicious" },
          },
        },
      });

      expect(() => serializer.deserialize(payload)).toThrow(/Unknown type/);
    });

    it("should handle unsupported node kind gracefully", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "obj_1" },
        nodes: {
          obj_1: {
            kind: "unknown_kind",
            value: {},
          },
        },
      });

      expect(() => serializer.deserialize(payload)).toThrow(
        /Unsupported node kind/,
      );
    });
  });
});
