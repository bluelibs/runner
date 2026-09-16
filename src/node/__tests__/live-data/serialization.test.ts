import { Serializer, type SerializerLike } from "../../../serializer";
import {
  cloneLiveValue,
  serializeLiveValue,
} from "../../live-data/serialization";

class BsonValue {
  readonly _bsontype = "ExampleBson";

  constructor(readonly value: string) {}
}

class AlternateBsonValue {
  readonly _bsontype = "ExampleBson";

  constructor(readonly value: string) {}
}

function registeredSerializer(): Serializer {
  return new Serializer({
    types: [
      {
        id: "LiveDataExampleBson",
        is: (value: unknown): value is BsonValue => value instanceof BsonValue,
        serialize: (value) => value.value,
        deserialize: (value) => new BsonValue(value),
        strategy: "value",
      },
    ],
  });
}

function serializerReturning(roundTripped: unknown): SerializerLike {
  return {
    stringify: () => "payload",
    parse: <T>() => roundTripped as T,
  };
}

describe("live-data serialization", () => {
  it("serializes and clones JSON-compatible values", () => {
    const serializer = new Serializer();
    const value = { records: [{ id: "one" }], empty: null };
    const payload = serializeLiveValue(value, serializer);
    const clone = cloneLiveValue(value, serializer);

    expect(serializer.parse(payload)).toEqual(value);
    expect(clone).toEqual(value);
    expect(clone).not.toBe(value);
    expect(clone.records).not.toBe(value.records);
  });

  it("preserves registered BSON constructors through nested values", () => {
    const serializer = registeredSerializer();
    const source = {
      bson: new BsonValue("root"),
      list: [new BsonValue("nested")],
    };

    const clone = cloneLiveValue(source, serializer);
    expect(clone.bson).toBeInstanceOf(BsonValue);
    expect(clone.list[0]).toBeInstanceOf(BsonValue);
    expect(() => serializeLiveValue(source, serializer)).not.toThrow();
  });

  it("preserves registered BSON constructors in Map keys, values, and Sets", () => {
    const serializer = registeredSerializer();
    const source = {
      map: new Map([[new BsonValue("key"), new BsonValue("value")]]),
      set: new Set([new BsonValue("member")]),
    };

    const clone = cloneLiveValue(source, serializer);
    const [mapEntry] = [...clone.map];
    const [setValue] = [...clone.set];
    expect(mapEntry[0]).toBeInstanceOf(BsonValue);
    expect(mapEntry[1]).toBeInstanceOf(BsonValue);
    expect(setValue).toBeInstanceOf(BsonValue);
  });

  it("validates each decoded copy of an aliased BSON-bearing object", () => {
    const serializer = registeredSerializer();
    const shared = { id: new BsonValue("shared") };
    const source = {
      first: shared,
      second: shared,
      map: new Map([[shared, shared]]),
      set: new Set([shared]),
    };

    const clone = cloneLiveValue(source, serializer);
    const [mapEntry] = [...clone.map];
    const [setValue] = [...clone.set];
    expect(clone.first.id).toBeInstanceOf(BsonValue);
    expect(clone.second.id).toBeInstanceOf(BsonValue);
    expect(mapEntry[0].id).toBeInstanceOf(BsonValue);
    expect(mapEntry[1].id).toBeInstanceOf(BsonValue);
    expect(setValue.id).toBeInstanceOf(BsonValue);
  });

  it("terminates BSON verification for already-seen cyclic values", () => {
    const source: { bson: BsonValue; self?: unknown } = {
      bson: new BsonValue("source"),
    };
    const target: { bson: BsonValue; self?: unknown } = {
      bson: new BsonValue("target"),
    };
    source.self = source;
    target.self = target;

    expect(() =>
      serializeLiveValue(source, serializerReturning(target)),
    ).not.toThrow();
  });

  it("fails instead of silently flattening unregistered BSON values", () => {
    const serializer = new Serializer();
    expect(() =>
      serializeLiveValue({ nested: [new BsonValue("one")] }, serializer),
    ).toThrow(/BSON values must be registered/);
    expect(() => cloneLiveValue(new BsonValue("two"), serializer)).toThrow(
      /BSON values must be registered/,
    );
  });

  it.each([
    ["Map key", new Map([[new BsonValue("key"), "value"]])],
    ["Map value", new Map([["key", new BsonValue("value")]])],
    ["Set value", new Set([new BsonValue("member")])],
  ])("rejects an unregistered BSON %s", (_label, source) => {
    expect(() => cloneLiveValue(source, new Serializer())).toThrow(
      /BSON values must be registered/,
    );
  });

  it("preserves cycles through Map and Set containers", () => {
    const sourceMap = new Map<unknown, unknown>();
    const sourceSet = new Set<unknown>();
    const targetMap = new Map<unknown, unknown>();
    const targetSet = new Set<unknown>();
    sourceMap.set(sourceMap, new BsonValue("value"));
    sourceMap.set("set", sourceSet);
    sourceSet.add(sourceMap);
    targetMap.set(targetMap, new BsonValue("value"));
    targetMap.set("set", targetSet);
    targetSet.add(targetMap);

    expect(() =>
      serializeLiveValue(sourceMap, serializerReturning(targetMap)),
    ).not.toThrow();
  });

  it.each([
    ["Map type", new Map([["key", new BsonValue("value")]]), {}],
    ["Map size", new Map([["key", new BsonValue("value")]]), new Map()],
    ["Set type", new Set([new BsonValue("value")]), []],
    ["Set size", new Set([new BsonValue("value")]), new Set()],
  ])(
    "rejects an incompatible %s after serialization",
    (_label, source, target) => {
      expect(() =>
        serializeLiveValue(source, serializerReturning(target)),
      ).toThrow(/BSON values must be registered/);
    },
  );

  it.each([
    ["missing target", null],
    ["primitive target", "plain"],
    ["wrong BSON type", { _bsontype: "OtherBson" }],
    ["wrong constructor", new AlternateBsonValue("one")],
  ])("rejects %s during BSON round-trip verification", (_label, target) => {
    expect(() =>
      serializeLiveValue(new BsonValue("one"), serializerReturning(target)),
    ).toThrow(/BSON values must be registered/);
  });

  it("rejects BSON arrays or objects reconstructed as incompatible containers", () => {
    expect(() =>
      serializeLiveValue(
        [new BsonValue("one")],
        serializerReturning({ 0: new BsonValue("one") }),
      ),
    ).toThrow(/BSON values must be registered/);
    expect(() =>
      serializeLiveValue(
        { nested: new BsonValue("one") },
        serializerReturning(null),
      ),
    ).toThrow(/BSON values must be registered/);
  });
});
