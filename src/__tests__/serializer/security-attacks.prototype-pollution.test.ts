/**
 * Security attack vector tests for Serializer
 *
 * Focus: prototype pollution vectors.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { Serializer } from "../../serializer/index";

describe("Serializer Security Attacks", () => {
  let serializer: Serializer;

  beforeEach(() => {
    serializer = new Serializer();
  });

  describe("Prototype Pollution Attacks", () => {
    it("should not pollute Object.prototype via __proto__ in legacy format", () => {
      const originalPolluted = ({} as { polluted?: boolean }).polluted;

      const payload = JSON.stringify({
        ["__proto__"]: { polluted: true },
        safe: 1,
      });

      serializer.deserialize(payload);

      expect(({} as { polluted?: boolean }).polluted).toBe(originalPolluted);
    });

    it("should not pollute Object.prototype via constructor.prototype", () => {
      const originalPolluted = ({} as { exploited?: boolean }).exploited;

      const payload = JSON.stringify({
        constructor: { prototype: { exploited: true } },
        safe: 1,
      });

      serializer.deserialize(payload);

      expect(({} as { exploited?: boolean }).exploited).toBe(originalPolluted);
    });

    it("should filter __proto__ from graph node values", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "obj_1" },
        nodes: {
          obj_1: {
            kind: "object",
            value: {
              ["__proto__"]: { polluted: true },
              constructor: { prototype: { polluted: true } },
              legitimate: "value",
            },
          },
        },
      });

      const result = serializer.deserialize<Record<string, unknown>>(payload);

      expect(result.legitimate).toBe("value");
      expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(
        false,
      );
      expect(Object.prototype.hasOwnProperty.call(result, "constructor")).toBe(
        false,
      );
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    });

    it("should filter unsafe keys from array node index-like keys", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "obj_1" },
        nodes: {
          obj_1: {
            kind: "array",
            value: [1, 2, 3],
          },
        },
      });

      const result = serializer.deserialize<number[]>(payload);
      expect(result).toEqual([1, 2, 3]);
    });
  });
});
