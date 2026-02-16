import { Serializer } from "../../serializer";
import {
  DateType,
  NonFiniteNumberType,
  UndefinedType,
} from "../../serializer/builtins";
import {
  assertNonFiniteNumberTag,
  getNonFiniteNumberTag,
  NonFiniteNumberTag,
  serializeNonFiniteNumber,
  SpecialTypeId,
} from "../../serializer/special-values";
import type {
  DeserializationContext,
  SerializedNode,
} from "../../serializer/types";

describe("GraphSerializer coverage", () => {
  const serializer = new Serializer();

  it("skips inherited properties but preserves undefined values during serialization", () => {
    const base = { inherited: "skip-me" };
    const obj = Object.create(base);
    obj.keep = "ok";
    obj.drop = undefined;

    const payload = JSON.parse(serializer.serialize(obj)) as {
      root: { __ref: string };
      nodes: Record<
        string,
        {
          value: {
            keep?: string;
            drop?: { __type: string; value: null };
            inherited?: unknown;
          };
        }
      >;
    };
    const rootId = payload.root.__ref;
    const rootNode = payload.nodes[rootId];

    expect(rootNode.value).toEqual({
      keep: "ok",
      drop: { __type: "Undefined", value: null },
    });
    expect(rootNode.value.inherited).toBeUndefined();
    expect(rootNode.value.drop?.__type).toBe("Undefined");
  });

  it("handles malformed graph payload nodes defensively", () => {
    const nodeRecord = serializer.toNodeRecord(null as never);
    expect(Object.keys(nodeRecord)).toHaveLength(0);
  });

  it("skips inherited fields during deserialization", () => {
    const payload = JSON.stringify({
      __graph: true,
      version: 1,
      root: { __ref: "obj" },
      nodes: {
        obj: {
          kind: "object",
          value: Object.assign(Object.create({ ghost: { __ref: "none" } }), {
            real: { __ref: "arr" },
          }),
        },
        arr: { kind: "array", value: [] },
      },
    });

    const result = serializer.deserialize(payload) as {
      real: unknown[];
      ghost?: unknown;
    };
    expect(result).toEqual({ real: [] });
    expect(result.ghost).toBeUndefined();

    const context: DeserializationContext = {
      nodes: {},
      resolved: new Map(),
      resolving: new Set<string>(),
      resolvingRefs: new Set<string>(),
    };
    const protoObj = Object.create({ hidden: true });
    protoObj.visible = 5;

    const value = serializer.deserializeValue(protoObj, context) as {
      visible: number;
      hidden?: unknown;
    };
    expect(value).toEqual({ visible: 5 });
    expect(value.hidden).toBeUndefined();
  });

  it("mergePlaceholder covers identity and fallback branches", () => {
    const target = { k: 1 };
    const merged = serializer.mergePlaceholder(target, target);
    expect(merged).toBe(target);

    const fallback = serializer.mergePlaceholder(5, "x");
    expect(fallback).toBe("x");
  });

  it("isSerializedTypeRecord guards non-objects", () => {
    expect(serializer.isSerializedTypeRecord(5)).toBe(false);
  });

  it("skips inherited keys when resolving object references", () => {
    const context: DeserializationContext = {
      nodes: {
        obj: {
          kind: "object",
          value: Object.assign(Object.create({ ghost: { __ref: "leaf" } }), {
            own: { __ref: "leaf" },
          }),
        } as SerializedNode,
        leaf: { kind: "array", value: [] } as SerializedNode,
      } as Record<string, SerializedNode>,
      resolved: new Map(),
      resolving: new Set<string>(),
      resolvingRefs: new Set<string>(),
    };

    const result = serializer.resolveReference("obj", context) as {
      own: unknown[];
      ghost?: unknown;
    };
    expect(result).toEqual({ own: [] });
    expect(result.ghost).toBeUndefined();
  });

  it("honors pretty option", () => {
    const pretty = new Serializer({ pretty: true });
    const output = pretty.serialize({ a: 1 });
    expect(output.includes("\n")).toBe(true);
  });

  it("roundtrips Date via type node (create + mergePlaceholder path)", () => {
    const date = new Date("2024-01-02T03:04:05.006Z");
    const text = serializer.serialize(date);
    const parsed = serializer.deserialize<Date>(text);
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed.getTime()).toBe(date.getTime());
  });

  it("mergePlaceholder handles Date instances", () => {
    const merged = serializer.mergePlaceholder(
      new Date(0),
      new Date("2024-01-01T00:00:00.000Z"),
    );
    expect(merged).toBeInstanceOf(Date);
    expect((merged as Date).getTime()).toBe(
      new Date("2024-01-01T00:00:00.000Z").getTime(),
    );
  });

  it("covers built-in DateType create", () => {
    const d = DateType.create?.();
    expect(d).toBeInstanceOf(Date);
  });

  it("covers special-values helpers", () => {
    expect(getNonFiniteNumberTag(Number.NaN)).toBe(NonFiniteNumberTag.NaN);
    expect(getNonFiniteNumberTag(Number.POSITIVE_INFINITY)).toBe(
      NonFiniteNumberTag.Infinity,
    );
    expect(getNonFiniteNumberTag(Number.NEGATIVE_INFINITY)).toBe(
      NonFiniteNumberTag.NegativeInfinity,
    );
    expect(getNonFiniteNumberTag(123)).toBeNull();

    expect(serializeNonFiniteNumber(Number.POSITIVE_INFINITY)).toEqual({
      __type: SpecialTypeId.NonFiniteNumber,
      value: NonFiniteNumberTag.Infinity,
    });
    expect(() => serializeNonFiniteNumber(0)).toThrow(
      "Expected non-finite number",
    );

    expect(assertNonFiniteNumberTag(NonFiniteNumberTag.NaN)).toBe(
      NonFiniteNumberTag.NaN,
    );
    expect(() => assertNonFiniteNumberTag("nope")).toThrow(
      "Invalid non-finite number payload",
    );
  });

  it("covers built-in special types (Undefined + NonFiniteNumber)", () => {
    expect(UndefinedType.serialize(undefined)).toBeNull();
    expect(UndefinedType.deserialize(null)).toBeUndefined();

    expect(NonFiniteNumberType.is("nope")).toBe(false);
    expect(NonFiniteNumberType.is(1)).toBe(false);
    expect(NonFiniteNumberType.is(Number.POSITIVE_INFINITY)).toBe(true);

    expect(NonFiniteNumberType.serialize(Number.POSITIVE_INFINITY)).toBe(
      NonFiniteNumberTag.Infinity,
    );
    expect(() => NonFiniteNumberType.serialize(1)).toThrow(
      "Expected non-finite number",
    );
    expect(NonFiniteNumberType.deserialize(NonFiniteNumberTag.NaN)).toBeNaN();
    expect(NonFiniteNumberType.deserialize(NonFiniteNumberTag.Infinity)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(
      NonFiniteNumberType.deserialize(NonFiniteNumberTag.NegativeInfinity),
    ).toBe(Number.NEGATIVE_INFINITY);
  });

  it("throws on unknown __type during deserializeValue", () => {
    const ctx: DeserializationContext = {
      nodes: {},
      resolved: new Map(),
      resolving: new Set<string>(),
      resolvingRefs: new Set<string>(),
    };
    expect(() =>
      serializer.deserializeValue({ __type: "Missing", value: {} }, ctx),
    ).toThrow(/Unknown type/);
  });
});
