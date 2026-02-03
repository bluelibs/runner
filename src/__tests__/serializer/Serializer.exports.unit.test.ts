import { Serializer } from "../../index";

describe("index exports: serializer", () => {
  it("allows custom type registration via Serializer.addType(name, factory)", () => {
    const serializer = new Serializer();
    class IndexExportSmoke {
      constructor(public v: number) {}
      toJSONValue() {
        return { v: this.v } as const;
      }
      typeName() {
        return "IndexExportSmoke" as const;
      }
    }

    serializer.addType(
      "IndexExportSmoke",
      (j: { v: number }) => new IndexExportSmoke(j.v),
    );

    const encoded = serializer.stringify({ x: new IndexExportSmoke(7) });
    const decoded = serializer.parse(encoded) as { x: IndexExportSmoke };
    expect(decoded.x).toBeInstanceOf(IndexExportSmoke);
    expect(decoded.x.v).toBe(7);
  });
});
