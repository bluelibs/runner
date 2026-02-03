import { describe, it, expect, beforeEach } from "@jest/globals";
import { Serializer } from "../../serializer/Serializer";
import type { TypeDefinition } from "../../serializer/types";

describe("Serializer type placeholders (no create)", () => {
  let serializer: Serializer;

  beforeEach(() => {
    serializer = new Serializer();
  });

  it("returns null when a no-create type deserializes to a non-object and no cycle is involved", () => {
    const nullType: TypeDefinition<object, unknown> = {
      id: "NoCreateNull",
      is: (_obj: unknown): _obj is object => false,
      serialize: (_obj: object) => ({}),
      deserialize: (_data: unknown) => null as unknown as object,
    };
    serializer.addType(nullType);

    const payload = JSON.stringify({
      __graph: true,
      version: 1,
      root: { __ref: "obj_1" },
      nodes: {
        obj_1: { kind: "type", type: "NoCreateNull", value: {} },
      },
    });

    expect(serializer.deserialize(payload)).toBeNull();
  });

  it("throws when a no-create type deserializes to a non-object but a cycle relies on its placeholder", () => {
    const nullType: TypeDefinition<object, unknown> = {
      id: "NoCreateNullWithCycle",
      is: (_obj: unknown): _obj is object => false,
      serialize: (_obj: object) => ({}),
      deserialize: (_data: unknown) => null as unknown as object,
    };
    serializer.addType(nullType);

    const payload = JSON.stringify({
      __graph: true,
      version: 1,
      root: { __ref: "obj_1" },
      nodes: {
        obj_1: {
          kind: "type",
          type: "NoCreateNullWithCycle",
          value: { self: { __ref: "obj_1" } },
        },
      },
    });

    expect(() => serializer.deserialize(payload)).toThrow(
      "Cannot preserve circular references",
    );
  });

  it("returns the result for internal-slot objects when no cycle is involved", () => {
    const dateType: TypeDefinition<object, unknown> = {
      id: "NoCreateDate",
      is: (_obj: unknown): _obj is object => false,
      serialize: (_obj: object) => ({}),
      deserialize: (_data: unknown) => new Date(0) as unknown as object,
    };
    serializer.addType(dateType);

    const payload = JSON.stringify({
      __graph: true,
      version: 1,
      root: { __ref: "obj_1" },
      nodes: {
        obj_1: { kind: "type", type: "NoCreateDate", value: {} },
      },
    });

    const result = serializer.deserialize(payload);
    expect(result).toBeInstanceOf(Date);
    expect((result as Date).getTime()).toBe(0);
  });

  it("throws for internal-slot objects when a cycle relies on the placeholder and create() is missing", () => {
    const dateType: TypeDefinition<object, unknown> = {
      id: "NoCreateDateWithCycle",
      is: (_obj: unknown): _obj is object => false,
      serialize: (_obj: object) => ({}),
      deserialize: (_data: unknown) => new Date(0) as unknown as object,
    };
    serializer.addType(dateType);

    const payload = JSON.stringify({
      __graph: true,
      version: 1,
      root: { __ref: "obj_1" },
      nodes: {
        obj_1: {
          kind: "type",
          type: "NoCreateDateWithCycle",
          value: { self: { __ref: "obj_1" } },
        },
      },
    });

    expect(() => serializer.deserialize(payload)).toThrow(
      "Cannot preserve circular references",
    );
  });

  it("supports deserialize returning the placeholder itself", () => {
    const placeholderType: TypeDefinition<object, { self: unknown }> = {
      id: "NoCreatePlaceholderReturn",
      is: (_obj: unknown): _obj is object => false,
      serialize: (_obj: object) => ({ self: {} }),
      deserialize: (data: { self: unknown }) => {
        const placeholder = data.self as Record<string, unknown>;
        placeholder.ok = true;
        placeholder.me = placeholder;
        return placeholder as unknown as object;
      },
    };
    serializer.addType(placeholderType);

    const payload = JSON.stringify({
      __graph: true,
      version: 1,
      root: { __ref: "obj_1" },
      nodes: {
        obj_1: {
          kind: "type",
          type: "NoCreatePlaceholderReturn",
          value: { self: { __ref: "obj_1" } },
        },
      },
    });

    const result = serializer.deserialize<Record<string, unknown>>(payload);
    expect(result.ok).toBe(true);
    expect(result.me).toBe(result);
  });

  it("copies symbol properties from deserialized instances", () => {
    const secret = Symbol("secret");

    class WithSymbol {
      constructor(public name: string) {}
    }

    const withSymbolType: TypeDefinition<WithSymbol, unknown> = {
      id: "NoCreateWithSymbol",
      is: (_obj: unknown): _obj is WithSymbol => false,
      serialize: (_obj: WithSymbol) => ({}),
      deserialize: (_data: unknown) => {
        const instance = new WithSymbol("ok");
        Object.defineProperty(instance, secret, {
          value: 123,
          enumerable: true,
          configurable: true,
          writable: true,
        });
        return instance;
      },
    };
    serializer.addType(withSymbolType);

    const payload = JSON.stringify({
      __graph: true,
      version: 1,
      root: { __ref: "obj_1" },
      nodes: {
        obj_1: { kind: "type", type: "NoCreateWithSymbol", value: {} },
      },
    });

    const result = serializer.deserialize<WithSymbol>(payload);
    expect(result).toBeInstanceOf(WithSymbol);
    expect(result.name).toBe("ok");
    expect((result as unknown as Record<symbol, unknown>)[secret]).toBe(123);
  });

  it("skips unsafe keys when copying properties onto the placeholder", () => {
    const unsafeKeyType: TypeDefinition<object, unknown> = {
      id: "NoCreateUnsafeKeys",
      is: (_obj: unknown): _obj is object => false,
      serialize: (_obj: object) => ({}),
      deserialize: (_data: unknown) => {
        const instance: Record<string, unknown> = {};
        Object.defineProperty(instance, "__proto__", {
          value: { polluted: true },
          enumerable: true,
          configurable: true,
        });
        instance.safe = 1;
        return instance as unknown as object;
      },
    };
    serializer.addType(unsafeKeyType);

    const payload = JSON.stringify({
      __graph: true,
      version: 1,
      root: { __ref: "obj_1" },
      nodes: {
        obj_1: { kind: "type", type: "NoCreateUnsafeKeys", value: {} },
      },
    });

    const result = serializer.deserialize<Record<string, unknown>>(payload);
    expect(result.safe).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(
      false,
    );
    expect((result as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("handles proxies that report symbols without descriptors", () => {
    const ghostSymbol = Symbol("ghost");
    const target: Record<string, unknown> = { ok: 1 };
    const proxy = new Proxy(target, {
      ownKeys: (t) => [...Reflect.ownKeys(t), ghostSymbol],
      getOwnPropertyDescriptor: (t, prop) => {
        if (prop === ghostSymbol) {
          return undefined;
        }
        return Reflect.getOwnPropertyDescriptor(t, prop);
      },
    });

    const proxyType: TypeDefinition<object, unknown> = {
      id: "NoCreateProxySymbols",
      is: (_obj: unknown): _obj is object => false,
      serialize: (_obj: object) => ({}),
      deserialize: (_data: unknown) => proxy as unknown as object,
    };
    serializer.addType(proxyType);

    const payload = JSON.stringify({
      __graph: true,
      version: 1,
      root: { __ref: "obj_1" },
      nodes: {
        obj_1: { kind: "type", type: "NoCreateProxySymbols", value: {} },
      },
    });

    const result = serializer.deserialize<Record<string, unknown>>(payload);
    expect(result.ok).toBe(1);
  });

  it("keeps a null-prototype placeholder when the deserialized result is also null-prototype", () => {
    const nullProtoType: TypeDefinition<object, unknown> = {
      id: "NoCreateNullProto",
      is: (_obj: unknown): _obj is object => false,
      serialize: (_obj: object) => ({}),
      deserialize: (_data: unknown) => {
        const instance = Object.create(null) as Record<string, unknown>;
        instance.ok = true;
        return instance as unknown as object;
      },
    };
    serializer.addType(nullProtoType);

    const payload = JSON.stringify({
      __graph: true,
      version: 1,
      root: { __ref: "obj_1" },
      nodes: {
        obj_1: { kind: "type", type: "NoCreateNullProto", value: {} },
      },
    });

    const result = serializer.deserialize<Record<string, unknown>>(payload);
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(result.ok).toBe(true);
  });
});
