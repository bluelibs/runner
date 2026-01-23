/**
 * Security attack vector tests for Serializer
 *
 * Focus: values that should not be serializable.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { Serializer } from "../../serializer/index";

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

    it("serializes bigints via a safe string encoding", () => {
      const withBigInt = {
        big: BigInt(9007199254740991),
      };

      const payload = serializer.serialize(withBigInt);
      const roundTripped = serializer.deserialize<typeof withBigInt>(payload);

      expect(roundTripped.big).toBe(BigInt(9007199254740991));
    });

    it("serializes global symbols (Symbol.for)", () => {
      const sym = Symbol.for("sec.sym.global");
      const payload = serializer.serialize({ sym });
      const roundTripped = serializer.deserialize<{ sym: symbol }>(payload);

      expect(roundTripped.sym).toBe(sym);
    });

    it("serializes well-known symbols (ex: Symbol.iterator)", () => {
      const sym = Symbol.iterator;
      const payload = serializer.serialize({ sym });
      const roundTripped = serializer.deserialize<{ sym: symbol }>(payload);

      expect(roundTripped.sym).toBe(sym);
    });

    it('rejects unique symbols (Symbol("..."))', () => {
      expect(() => serializer.serialize({ sym: Symbol("evil") })).toThrow(
        /unique symbols/i,
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
