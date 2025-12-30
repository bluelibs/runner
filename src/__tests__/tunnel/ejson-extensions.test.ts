import { EJSON } from "../../globals/resources/tunnel/ejson-extensions";
import { getDefaultSerializer } from "../../globals/resources/tunnel/serializer";

describe("EJSON extensions", () => {
  it("supports custom type via serializer.addType", () => {
    class Distance {
      constructor(
        public value: number,
        public unit: string,
      ) {}
      toJSONValue() {
        return { value: this.value, unit: this.unit } as const;
      }
      typeName() {
        return "Distance2" as const;
      }
    }

    const s = getDefaultSerializer();
    // Register via the serializer's addType method
    s.addType?.(
      "Distance2",
      (j: { value: number; unit: string }) => new Distance(j.value, j.unit),
    );

    const encoded = s.stringify({ d: new Distance(10, "m") });
    // GraphSerializer uses __type for inline types
    expect(encoded).toContain("__type");
    expect(encoded).toContain("Distance2");
    
    const decoded = s.parse<{ d: Distance }>(encoded);
    expect(decoded.d).toBeInstanceOf(Distance);
    expect(decoded.d.value).toBe(10);
    expect(decoded.d.unit).toBe("m");
  });

  it("roundtrips custom types registered via serializer", () => {
    class X2 {
      constructor(public v: number) {}
      toJSONValue() {
        return { v: this.v };
      }
      typeName() {
        return "X2" as const;
      }
    }

    const s = getDefaultSerializer();
    s.addType?.("X2", (j: { v: number }) => new X2(j.v));

    const encoded = s.stringify({ x: new X2(7) });
    const decoded = s.parse<{ x: X2 }>(encoded);
    expect(decoded.x).toBeInstanceOf(X2);
    expect(decoded.x.v).toBe(7);
  });

  it("EJSON API is callable repeatedly without side-effects", () => {
    expect(() => EJSON.stringify({})).not.toThrow();
    expect(() => EJSON.stringify({})).not.toThrow();
  });
});
