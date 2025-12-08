import { Serializer } from "../../serializer";
import { DateType } from "../../serializer/builtins";

describe("GraphSerializer coverage", () => {
  const serializer = new Serializer();

  it("skips inherited and undefined properties during serialization", () => {
    const base = { inherited: "skip-me" };
    const obj = Object.create(base);
    obj.keep = "ok";
    obj.drop = undefined;

    const payload = JSON.parse(serializer.serialize(obj)) as any;
    const rootId = payload.root.__ref;
    const rootNode = payload.nodes[rootId];

    expect(rootNode.value).toEqual({ keep: "ok" });
    expect(rootNode.value.inherited).toBeUndefined();
    expect(rootNode.value.drop).toBeUndefined();
  });

  it("handles malformed graph payload nodes defensively", () => {
    const nodeRecord = (serializer as any).toNodeRecord(null);
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
          value: Object.assign(
            Object.create({ ghost: { __ref: "none" } }),
            { real: { __ref: "arr" } },
          ),
        },
        arr: { kind: "array", value: [] },
      },
    });

    const result = serializer.deserialize(payload) as any;
    expect(result).toEqual({ real: [] });
    expect(result.ghost).toBeUndefined();

    const context = {
      nodes: {},
      resolved: new Map(),
      resolving: new Set(),
    };
    const protoObj = Object.create({ hidden: true });
    protoObj.visible = 5;

    const value = (serializer as any).deserializeValue(protoObj, context);
    expect(value).toEqual({ visible: 5 });
    expect((value as any).hidden).toBeUndefined();
  });

  it("mergePlaceholder covers identity and fallback branches", () => {
    const target = { k: 1 };
    const merged = (serializer as any).mergePlaceholder(target, target);
    expect(merged).toBe(target);

    const fallback = (serializer as any).mergePlaceholder(5, "x");
    expect(fallback).toBe("x");
  });

  it("isSerializedTypeRecord guards non-objects", () => {
    expect((serializer as any).isSerializedTypeRecord(5)).toBe(false);
  });

  it("skips inherited keys when resolving object references", () => {
    const context = {
      nodes: {
        obj: {
          kind: "object",
          value: Object.assign(
            Object.create({ ghost: { __ref: "leaf" } }),
            { own: { __ref: "leaf" } },
          ),
        },
        leaf: { kind: "array", value: [] },
      },
      resolved: new Map(),
      resolving: new Set(),
    };

    const result = (serializer as any).resolveReference("obj", context);
    expect(result).toEqual({ own: [] });
    expect((result as any).ghost).toBeUndefined();
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
    const merged = (serializer as any).mergePlaceholder(
      new Date(0),
      new Date("2024-01-01T00:00:00.000Z"),
    );
    expect(merged).toBeInstanceOf(Date);
    expect((merged as Date).getTime()).toBe(new Date("2024-01-01T00:00:00.000Z").getTime());
  });

  it("covers built-in DateType create", () => {
    const d = DateType.create?.();
    expect(d).toBeInstanceOf(Date);
  });

  it("throws on unknown __type during deserializeValue", () => {
    const ctx = { nodes: {}, resolved: new Map(), resolving: new Set() };
    expect(() =>
      (serializer as any).deserializeValue({ __type: "Missing", value: {} }, ctx),
    ).toThrow(/Unknown type/);
  });
});
