import { EJSON } from "../../globals/resources/tunnel/ejson-extensions";
import { getDefaultSerializer } from "../../globals/resources/tunnel/serializer";

describe("EJSON type registration - stability", () => {
  it("ignores unknown $type sentinels gracefully", () => {
    const text = '{"x":{"$type":"__Unknown__","v":1}}';
    const obj = EJSON.parse(text) as any;
    expect(obj.x).toEqual({ $type: "__Unknown__", v: 1 });
  });

  it("supports late EJSON.addType registration after serializer use", () => {
    // Force serializer creation
    getDefaultSerializer();

    class Later {
      constructor(public v: number) {}
      toJSONValue() {
        return { v: this.v };
      }
      typeName() {
        return "Later" as const;
      }
    }
    EJSON.addType("Later", (j: { v: number }) => new Later(j.v));
    const text = EJSON.stringify({ x: new Later(3) });
    const obj = EJSON.parse(text) as { x: Later };
    expect(obj.x).toBeInstanceOf(Later);
    expect(obj.x.v).toBe(3);
  });
});
