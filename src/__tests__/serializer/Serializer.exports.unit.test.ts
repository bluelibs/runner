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
});
