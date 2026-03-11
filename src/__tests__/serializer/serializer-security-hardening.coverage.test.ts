import { beforeEach, describe, expect, it } from "@jest/globals";
import { Serializer } from "../../serializer/index";
import {
  isBoundedQuantifier,
  isQuantifierAt,
  isQuantifierChar,
  isRegExpPatternSafe,
} from "../../serializer/regexp-validator";
import { DEFAULT_UNSAFE_KEYS, toNodeRecord } from "../../serializer/validation";
import { mergePlaceholder } from "../../serializer/deserializer";

describe("Serializer security hardening coverage", () => {
  let serializer: Serializer;

  beforeEach(() => {
    serializer = new Serializer();
  });

  describe("Security Hardening (coverage)", () => {
    it("skips unsafe keys during tree and graph serialization", () => {
      const record = Object.create(null) as Record<string, unknown>;
      record["__proto__"] = { polluted: true };
      record.safe = 1;

      const graphPayload = JSON.parse(serializer.serialize(record));
      const node = graphPayload.nodes.obj_1;
      expect(node.kind).toBe("object");
      expect(
        Object.prototype.hasOwnProperty.call(node.value, "__proto__"),
      ).toBe(false);
      expect(node.value.safe).toBe(1);

      const treePayload = JSON.parse(serializer.stringify(record));
      expect(
        Object.prototype.hasOwnProperty.call(treePayload, "__proto__"),
      ).toBe(false);
      expect(treePayload.safe).toBe(1);
    });

    it("rejects unsafe node ids in graph payloads", () => {
      const payload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "__proto__" },
        nodes: {
          __proto__: { kind: "object", value: { ok: true } },
        },
      });

      expect(() => serializer.deserialize(payload)).toThrow(
        'Unresolved reference id "__proto__"',
      );
    });

    it("enforces max depth during legacy deserialization", () => {
      const limited = new Serializer({ maxDepth: 1 });
      const payload = JSON.stringify({ level1: { level2: { ok: true } } });

      expect(() => limited.deserialize(payload)).toThrow(
        "Maximum depth exceeded (1)",
      );
    });

    it("respects type allowlists during deserialization", () => {
      const limited = new Serializer({ allowedTypes: ["Date"] });
      const payload = JSON.stringify({
        __type: "RegExp",
        value: { pattern: "test", flags: "" },
      });

      expect(() => limited.deserialize(payload)).toThrow(
        'Type "RegExp" is not allowed',
      );
    });

    it("validates RegExp payloads and patterns", () => {
      const unsafePayload = JSON.stringify({
        __type: "RegExp",
        value: { pattern: "(a{1,2})+", flags: "" },
      });
      expect(() => serializer.deserialize(unsafePayload)).toThrow(
        "Unsafe RegExp pattern",
      );

      const shortLimit = new Serializer({ maxRegExpPatternLength: 2 });
      const longPayload = JSON.stringify({
        __type: "RegExp",
        value: { pattern: "abc", flags: "" },
      });
      expect(() => shortLimit.deserialize(longPayload)).toThrow(
        "RegExp pattern exceeds limit (2)",
      );

      const invalidPayload = JSON.stringify({
        __type: "RegExp",
        value: { pattern: 123, flags: true },
      });
      expect(() => serializer.deserialize(invalidPayload)).toThrow(
        "Invalid RegExp payload",
      );

      const invalidNonObjectPayload = JSON.stringify({
        __type: "RegExp",
        value: null,
      });
      expect(() => serializer.deserialize(invalidNonObjectPayload)).toThrow(
        "Invalid RegExp payload",
      );
    });

    it("allows explicit overrides for RegExp validation", () => {
      const permissive = new Serializer({
        allowUnsafeRegExp: true,
        maxRegExpPatternLength: Number.POSITIVE_INFINITY,
      });
      const unsafePayload = JSON.stringify({
        __type: "RegExp",
        value: { pattern: "(a{1,2})+", flags: "" },
      });
      const unsafeResult = permissive.deserialize<RegExp>(unsafePayload);
      expect(unsafeResult).toBeInstanceOf(RegExp);

      const longPattern = "a".repeat(2000);
      const longPayload = JSON.stringify({
        __type: "RegExp",
        value: { pattern: longPattern, flags: "" },
      });
      const longResult = permissive.deserialize<RegExp>(longPayload);
      expect(longResult).toBeInstanceOf(RegExp);
    });

    it("covers RegExp heuristic helpers", () => {
      expect(isBoundedQuantifier("a{1,2}", 1)).toBe(true);
      expect(isBoundedQuantifier("a{1x}", 1)).toBe(false);
      expect(isBoundedQuantifier("a{", 1)).toBe(false);
      expect(isQuantifierAt("a+", 1)).toBe(true);
      expect(isQuantifierAt("a", 1)).toBe(false);
      expect(isQuantifierAt("a{1,2}", 1)).toBe(true);
      expect(isQuantifierChar("?", "(?", 1)).toBe(false);
      expect(isQuantifierChar("?", "a?", 1)).toBe(true);
      expect(isRegExpPatternSafe("((?:\\w+))[a-z]")).toBe(true);
      expect(isRegExpPatternSafe("(a+)+")).toBe(false);
      expect(isRegExpPatternSafe("^(a|aa)+$")).toBe(false);
      expect(isRegExpPatternSafe("(ab|cd)+")).toBe(true);
      expect(isRegExpPatternSafe("\\(?a")).toBe(true);
      expect(isRegExpPatternSafe("(ab)+")).toBe(true);
      expect(isRegExpPatternSafe("(a|)+")).toBe(false);
      expect(isRegExpPatternSafe("(a\\|b|aa)+")).toBe(true);
      expect(isRegExpPatternSafe("([a|b]|aa)+")).toBe(true);
      expect(isRegExpPatternSafe("((ab)|a)+")).toBe(true);
      expect(isRegExpPatternSafe("(?:a|aa)+")).toBe(false);
      expect(isRegExpPatternSafe("(?=a|aa)+")).toBe(false);
      expect(isRegExpPatternSafe("(?!a|aa)+")).toBe(false);
      expect(isRegExpPatternSafe("(?>a|aa)+")).toBe(false);
      expect(isRegExpPatternSafe("(?<=a|aa)+")).toBe(false);
      expect(isRegExpPatternSafe("(?<!a|aa)+")).toBe(false);
      expect(isRegExpPatternSafe("(?<name>a|aa)+")).toBe(false);
      expect(isRegExpPatternSafe("(?<a|aa)+")).toBe(true);
      expect(isRegExpPatternSafe("(?<name>a|b)+")).toBe(true);
      expect(typeof isRegExpPatternSafe("((a|b))+)")).toBe("boolean");
      expect(isRegExpPatternSafe(")a")).toBe(true);
    });

    it("covers node/key filtering helpers in graph and merge paths", () => {
      const proto = {};
      Object.defineProperty(proto, "inherited", {
        enumerable: true,
        value: { kind: "object", value: { inherited: true } },
      });
      const nodes: Record<string, unknown> = Object.create(proto);
      nodes.safe = { kind: "object", value: { ok: true } };
      (nodes as { constructor: unknown }).constructor = {
        kind: "object",
        value: { polluted: true },
      };

      const record = toNodeRecord(nodes as any);
      expect(record.safe).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(record, "constructor")).toBe(
        false,
      );
      expect(Object.prototype.hasOwnProperty.call(record, "inherited")).toBe(
        false,
      );

      const placeholder: Record<string, unknown> = {};
      const mergeProto = {};
      Object.defineProperty(mergeProto, "inherited", {
        enumerable: true,
        value: 1,
      });
      const mergeSource: Record<string, unknown> = Object.create(mergeProto);
      mergeSource.safe = 1;
      (mergeSource as { constructor: unknown }).constructor = 2;

      const merged = mergePlaceholder(
        placeholder,
        mergeSource,
        DEFAULT_UNSAFE_KEYS,
      );
      expect(merged).toBe(placeholder);
      expect(placeholder.safe).toBe(1);
      expect(
        Object.prototype.hasOwnProperty.call(placeholder, "constructor"),
      ).toBe(false);
      expect(
        Object.prototype.hasOwnProperty.call(placeholder, "inherited"),
      ).toBe(false);
    });

    it("drops unsafe keys during graph deserialization paths", () => {
      const rootObjectPayload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { ["__proto__"]: { polluted: true }, safe: 1 },
        nodes: {},
      });
      const rootObject =
        serializer.deserialize<Record<string, unknown>>(rootObjectPayload);
      expect(
        Object.prototype.hasOwnProperty.call(rootObject, "__proto__"),
      ).toBe(false);
      expect(rootObject.safe).toBe(1);

      const nodeObjectPayload = JSON.stringify({
        __graph: true,
        version: 1,
        root: { __ref: "obj_1" },
        nodes: {
          obj_1: {
            kind: "object",
            value: { ["__proto__"]: { polluted: true }, ok: true },
          },
        },
      });
      const nodeObject =
        serializer.deserialize<Record<string, unknown>>(nodeObjectPayload);
      expect(
        Object.prototype.hasOwnProperty.call(nodeObject, "__proto__"),
      ).toBe(false);
      expect(nodeObject.ok).toBe(true);
    });
  });
});
