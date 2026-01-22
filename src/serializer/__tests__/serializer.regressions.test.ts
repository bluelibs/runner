import { describe, it, expect, beforeEach } from "@jest/globals";
import { Serializer } from "../Serializer";
import type { TypeDefinition } from "../types";

describe("Serializer regressions", () => {
  let serializer: Serializer;

  beforeEach(() => {
    serializer = new Serializer();
  });

  it("preserves circular references for custom types without create()", () => {
    class CircularUser {
      constructor(
        public name: string,
        public self?: CircularUser,
      ) {}
    }

    const userType: TypeDefinition<
      CircularUser,
      { name: string; self: unknown }
    > = {
      id: "CircularUser",
      is: (obj: unknown): obj is CircularUser => obj instanceof CircularUser,
      serialize: (obj: CircularUser) => ({ name: obj.name, self: obj.self }),
      deserialize: (data: { name: string; self: unknown }) => {
        const user = new CircularUser(data.name);
        user.self = data.self as CircularUser | undefined;
        return user;
      },
    };

    serializer.addType(userType);

    const john = new CircularUser("John");
    john.self = john;

    const serialized = serializer.serialize(john);
    const deserialized = serializer.deserialize<CircularUser>(serialized);

    expect(deserialized).toBeInstanceOf(CircularUser);
    expect(deserialized.name).toBe("John");
    expect(deserialized.self).toBe(deserialized);
  });

  it("mergePlaceholder preserves defaults not in payload", () => {
    class Config {
      public debug: boolean = true;
      constructor(public port: number = 80) {}
    }

    const configType: TypeDefinition<Config, { port: number }> = {
      id: "Config",
      is: (obj: unknown): obj is Config => obj instanceof Config,
      serialize: (obj: Config) => ({ port: obj.port }),
      deserialize: (data: { port: number }) => new Config(data.port),
      create: () => new Config(),
    };

    serializer.addType(configType);

    const cfg = new Config(8080);
    cfg.debug = false;

    const serialized = serializer.serialize(cfg);
    const deserialized = serializer.deserialize<Config>(serialized);

    expect(deserialized.port).toBe(8080);
    expect(deserialized.debug).toBe(true);
  });

  it("preserves undefined keys in objects", () => {
    const obj = { a: undefined, b: 1 };
    const serialized = serializer.serialize(obj);
    const deserialized =
      serializer.deserialize<Record<string, unknown>>(serialized);

    expect(Object.prototype.hasOwnProperty.call(deserialized, "a")).toBe(true);
    expect(deserialized.a).toBeUndefined();
    expect(deserialized.b).toBe(1);
  });

  it("preserves undefined array slots", () => {
    const arr = [1, undefined, 3];
    const serialized = serializer.serialize(arr);
    const deserialized = serializer.deserialize<unknown[]>(serialized);

    expect(deserialized).toEqual([1, undefined, 3]);
    expect(Object.prototype.hasOwnProperty.call(deserialized, "1")).toBe(true);
  });

  it("preserves NaN", () => {
    const serialized = serializer.serialize(NaN);
    const deserialized = serializer.deserialize(serialized);
    expect(JSON.parse(serialized)).toEqual({
      __type: "NonFiniteNumber",
      value: "NaN",
    });
    expect(deserialized).toBeNaN();
  });

  it("preserves Infinity", () => {
    const serialized = serializer.serialize(Infinity);
    const deserialized = serializer.deserialize(serialized);
    expect(JSON.parse(serialized)).toEqual({
      __type: "NonFiniteNumber",
      value: "Infinity",
    });
    expect(deserialized).toBe(Infinity);
  });

  it("does not allow __proto__ injection via mergePlaceholder", () => {
    const maliciousType: TypeDefinition<object, object> = {
      id: "Malicious",
      is: (_obj: unknown): _obj is object => false,
      serialize: (_obj: object) => ({}),
      deserialize: (_data: unknown) => {
        const result = {};
        Object.defineProperty(result, "__proto__", {
          value: { polluted: true },
          enumerable: true,
        });
        return result;
      },
      create: () => ({}),
    };

    serializer.addType(maliciousType);

    const payload = JSON.stringify({
      __graph: true,
      version: 1,
      root: { __ref: "obj_1" },
      nodes: {
        obj_1: { kind: "type", type: "Malicious", value: {} },
      },
    });

    const deserialized = serializer.deserialize<object>(payload);

    expect((deserialized as Record<string, unknown>).polluted).toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(deserialized, "__proto__"),
    ).toBe(false);
  });
});
