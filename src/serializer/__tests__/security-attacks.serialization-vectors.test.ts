/**
 * Security attack vector tests for Serializer
 *
 * Focus: values that should not be serializable.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { Serializer } from "../index";

describe("Serializer Security Attacks", () => {
  let serializer: Serializer;

  beforeEach(() => {
    serializer = new Serializer();
  });

  describe("Serialization Attack Vectors", () => {
    it("should not allow serializing functions", () => {
      const withFunction = {
        fn: () => "evil",
      };

      expect(() => serializer.serialize(withFunction)).toThrow(
        /Cannot serialize value of type "function"/,
      );
    });

    it("should not allow serializing symbols", () => {
      const withSymbol = {
        sym: Symbol("evil"),
      };

      expect(() => serializer.serialize(withSymbol)).toThrow(
        /Cannot serialize value of type "symbol"/,
      );
    });

    it("should not allow serializing bigints", () => {
      const withBigInt = {
        big: BigInt(9007199254740991),
      };

      expect(() => serializer.serialize(withBigInt)).toThrow(
        /Cannot serialize value of type "bigint"/,
      );
    });

    it("should handle deep circular references during serialization", () => {
      interface DeepCircular {
        level: number;
        child?: DeepCircular;
        root?: DeepCircular;
      }

      const root: DeepCircular = { level: 0 };
      let current = root;
      for (let i = 1; i < 100; i++) {
        const next: DeepCircular = { level: i };
        current.child = next;
        next.root = root; // Every node references root
        current = next;
      }

      const serialized = serializer.serialize(root);
      const result = serializer.deserialize<DeepCircular>(serialized);

      expect(result.level).toBe(0);
      expect(result.child?.root).toBe(result);
    });
  });
});
