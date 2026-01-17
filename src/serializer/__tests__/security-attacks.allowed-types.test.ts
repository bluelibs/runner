/**
 * Security attack vector tests for Serializer
 *
 * Focus: allowedTypes enforcement.
 */

import { describe, it, expect } from "@jest/globals";
import { Serializer } from "../index";

describe("Serializer Security Attacks", () => {
  describe("AllowedTypes Restriction Attacks", () => {
    it("should reject non-whitelisted types when allowedTypes is set", () => {
      const restrictedSerializer = new Serializer({
        allowedTypes: ["Date"],
      });

      // Map is not in allowedTypes
      const payload = JSON.stringify({
        __type: "Map",
        value: [["key", "value"]],
      });

      expect(() => restrictedSerializer.deserialize(payload)).toThrow(
        /is not allowed/,
      );
    });

    it("should allow whitelisted types", () => {
      const restrictedSerializer = new Serializer({
        allowedTypes: ["Date"],
      });

      const date = new Date("2024-01-01");
      const serialized = restrictedSerializer.serialize(date);
      const result = restrictedSerializer.deserialize<Date>(serialized);

      expect(result).toBeInstanceOf(Date);
    });
  });
});
