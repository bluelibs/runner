/**
 * Security attack vector tests for Serializer
 *
 * Focus: graph cycles and circular reference handling.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { Serializer } from "../index";

describe("Serializer Security Attacks", () => {
  let serializer: Serializer;

  beforeEach(() => {
    serializer = new Serializer();
  });

  describe("Infinite Recursion Attacks", () => {
    it("should handle self-referential graph payloads safely", () => {
      // A node that references itself
      const maliciousPayload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "obj_1" },
        nodes: {
          obj_1: {
            kind: "object",
            value: { self: { __ref: "obj_1" } },
          },
        },
      });

      // Should not throw - handled via resolved cache
      const result = serializer.deserialize<{ self: unknown }>(
        maliciousPayload,
      );
      expect(result.self).toBe(result);
    });

    it("should handle circular chains in graph payloads", () => {
      // A -> B -> C -> A
      const circularChain = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "obj_1" },
        nodes: {
          obj_1: { kind: "object", value: { next: { __ref: "obj_2" } } },
          obj_2: { kind: "object", value: { next: { __ref: "obj_3" } } },
          obj_3: { kind: "object", value: { next: { __ref: "obj_1" } } },
        },
      });

      interface CircularNode {
        next: CircularNode;
      }

      const result = serializer.deserialize<CircularNode>(circularChain);
      expect(result.next.next.next).toBe(result);
    });

    it("should handle inline __ref that points to its parent object (sneaky self-reference)", () => {
      // Attempt to create inline self-reference without proper node registration
      // This is NOT a valid graph payload, so it should be treated as a plain object
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "obj_1" },
        nodes: {
          obj_1: {
            kind: "object",
            value: {
              a: { __ref: "obj_1" },
              b: { __ref: "obj_1" },
              c: { __ref: "obj_1" },
            },
          },
        },
      });

      // All refs should resolve to the same object (safe via caching)
      interface SelfRefNode {
        a: SelfRefNode;
        b: SelfRefNode;
        c: SelfRefNode;
      }
      const result = serializer.deserialize<SelfRefNode>(payload);
      expect(result.a).toBe(result);
      expect(result.b).toBe(result);
      expect(result.c).toBe(result);
    });

    it("should handle deeply nested type nodes with circular internal references", () => {
      // Create a type node whose value contains a ref back to itself
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "obj_1" },
        nodes: {
          obj_1: {
            kind: "type",
            type: "Map",
            value: [
              ["key1", { __ref: "obj_1" }],
              ["key2", "normal_value"],
            ],
          },
        },
      });

      const result = serializer.deserialize<Map<string, unknown>>(payload);
      expect(result).toBeInstanceOf(Map);
      expect(result.get("key1")).toBe(result);
      expect(result.get("key2")).toBe("normal_value");
    });

    it("should handle array node with multiple self-references", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "arr_1" },
        nodes: {
          arr_1: {
            kind: "array",
            value: [1, { __ref: "arr_1" }, 2, { __ref: "arr_1" }, 3],
          },
        },
      });

      const result = serializer.deserialize<unknown[]>(payload);
      expect(result[0]).toBe(1);
      expect(result[1]).toBe(result);
      expect(result[2]).toBe(2);
      expect(result[3]).toBe(result);
      expect(result[4]).toBe(3);
    });

    it("should handle mutually recursive graph structures (A contains B, B contains A)", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "obj_a" },
        nodes: {
          obj_a: {
            kind: "object",
            value: {
              name: "A",
              partner: { __ref: "obj_b" },
            },
          },
          obj_b: {
            kind: "object",
            value: {
              name: "B",
              partner: { __ref: "obj_a" },
            },
          },
        },
      });

      interface Partner {
        name: string;
        partner: Partner;
      }

      const result = serializer.deserialize<Partner>(payload);
      expect(result.name).toBe("A");
      expect(result.partner.name).toBe("B");
      expect(result.partner.partner).toBe(result);
      expect(result.partner.partner.partner).toBe(result.partner);
    });

    it("should handle crafted payload with __ref in non-graph context (legacy mode)", () => {
      // In legacy mode, __ref is just a regular key, not a reference
      const payload = JSON.stringify({
        __ref: "this_is_not_a_reference",
        data: "some_value",
      });

      const result = serializer.deserialize<Record<string, string>>(payload);
      expect(result.__ref).toBe("this_is_not_a_reference");
      expect(result.data).toBe("some_value");
    });

    it("should handle root that directly references itself", () => {
      // root IS the reference to a self-referencing node
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "self" },
        nodes: {
          self: {
            kind: "object",
            value: {
              me: { __ref: "self" },
              nested: {
                also_me: { __ref: "self" },
              },
            },
          },
        },
      });

      interface SelfNode {
        me: SelfNode;
        nested: { also_me: SelfNode };
      }

      const result = serializer.deserialize<SelfNode>(payload);
      expect(result.me).toBe(result);
      expect(result.nested.also_me).toBe(result);
    });

    it("should handle Set with self-reference", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "set_1" },
        nodes: {
          set_1: {
            kind: "type",
            type: "Set",
            value: [1, { __ref: "set_1" }, 3],
          },
        },
      });

      const result = serializer.deserialize<Set<unknown>>(payload);
      expect(result).toBeInstanceOf(Set);
      expect(result.has(1)).toBe(true);
      expect(result.has(result)).toBe(true);
      expect(result.has(3)).toBe(true);
    });

    it("should handle triple-nested circular: A -> B -> C -> A with all having refs to each other", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "a" },
        nodes: {
          a: {
            kind: "object",
            value: {
              name: "A",
              to_b: { __ref: "b" },
              to_c: { __ref: "c" },
            },
          },
          b: {
            kind: "object",
            value: {
              name: "B",
              to_a: { __ref: "a" },
              to_c: { __ref: "c" },
            },
          },
          c: {
            kind: "object",
            value: {
              name: "C",
              to_a: { __ref: "a" },
              to_b: { __ref: "b" },
            },
          },
        },
      });

      interface TripleNode {
        name: string;
        to_a?: TripleNode;
        to_b?: TripleNode;
        to_c?: TripleNode;
      }

      const result = serializer.deserialize<TripleNode>(payload);
      expect(result.name).toBe("A");
      expect(result.to_b?.name).toBe("B");
      expect(result.to_c?.name).toBe("C");
      expect(result.to_b?.to_a).toBe(result);
      expect(result.to_c?.to_a).toBe(result);
      expect(result.to_b?.to_c).toBe(result.to_c);
      expect(result.to_c?.to_b).toBe(result.to_b);
    });
  });
});
