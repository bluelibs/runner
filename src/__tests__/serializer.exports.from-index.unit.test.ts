import { EJSON } from "../index";

describe("index exports: EJSON & serializer", () => {
  it("allows custom type registration via EJSON.addType at root export", () => {
    class IndexExportSmoke {
      constructor(public v: number) {}
      toJSONValue() {
        return { v: this.v } as const;
      }
      typeName() {
        return "IndexExportSmoke" as const;
      }
    }

    EJSON.addType(
      "IndexExportSmoke",
      (j: { v: number }) => new IndexExportSmoke(j.v),
    );

    // Encode/decode a sentinel to exercise the extension path
    const encoded = EJSON.stringify({ x: { $type: "IndexExportSmoke", v: 7 } });
    const decoded = EJSON.parse(encoded) as { x: { v: number } };
    expect(decoded.x.v).toBe(7);
  });
});
