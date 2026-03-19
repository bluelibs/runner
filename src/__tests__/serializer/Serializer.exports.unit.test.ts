import { Serializer } from "../../index";

describe("index exports: serializer", () => {
  it("allows custom type registration via Serializer.addType(typeDefinition)", () => {
    const serializer = new Serializer();
    class IndexExportSmoke {
      constructor(public v: number) {}
    }

    serializer.addType({
      id: "IndexExportSmoke",
      is: (obj: unknown): obj is IndexExportSmoke =>
        obj instanceof IndexExportSmoke,
      serialize: (v) => ({ v: v.v }),
      deserialize: (j) => new IndexExportSmoke(j.v),
      strategy: "value",
    });

    const encoded = serializer.stringify({ x: new IndexExportSmoke(7) });
    const decoded = serializer.parse(encoded) as { x: IndexExportSmoke };
    expect(decoded.x).toBeInstanceOf(IndexExportSmoke);
    expect(decoded.x.v).toBe(7);
  });

  it("allows constructor-time custom type registration via Serializer({ types })", () => {
    class ConstructorTypeSmoke {
      constructor(public v: number) {}
    }

    const serializer = new Serializer({
      types: [
        {
          id: "ConstructorTypeSmoke",
          is: (obj: unknown): obj is ConstructorTypeSmoke =>
            obj instanceof ConstructorTypeSmoke,
          serialize: (v: ConstructorTypeSmoke) => ({ v: v.v }),
          deserialize: (j: { v: number }) => new ConstructorTypeSmoke(j.v),
          strategy: "value",
        },
      ],
    });

    const encoded = serializer.stringify({ x: new ConstructorTypeSmoke(9) });
    const decoded = serializer.parse(encoded) as { x: ConstructorTypeSmoke };
    expect(decoded.x).toBeInstanceOf(ConstructorTypeSmoke);
    expect(decoded.x.v).toBe(9);
  });
});
