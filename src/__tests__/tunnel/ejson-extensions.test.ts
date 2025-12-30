import { EJSON } from "../../globals/resources/tunnel/ejson-extensions";
import { getDefaultSerializer } from "../../globals/resources/tunnel/serializer";

describe("EJSON extensions", () => {
  it("supports custom type via direct EJSON.addType before serializer use", () => {
    class Distance {
      constructor(
        public value: number,
        public unit: string,
      ) {}
      toJSONValue() {
        return { value: this.value, unit: this.unit } as const;
      }
      typeName() {
        return "Distance" as const;
      }
    }
    EJSON.addType(
      "Distance",
      (j: { value: number; unit: string }) => new Distance(j.value, j.unit),
    );

    const s = getDefaultSerializer();
    const encoded = s.stringify({ d: new Distance(10, "m") });
    expect(encoded).toContain("$type");
    const decoded = s.parse<{ d: Distance }>(encoded);
    expect(decoded.d).toBeInstanceOf(Distance);
    expect(decoded.d.value).toBe(10);
    expect(decoded.d.unit).toBe("m");
  });

  it("supports late registration via EJSON.addType after serializer use", () => {
    // Force serializer creation
    getDefaultSerializer();

    class X {
      constructor(public v: number) {}
      toJSONValue() {
        return { v: this.v };
      }
      typeName() {
        return "X" as const;
      }
    }

    // Direct registration also works after serializer is obtained
    EJSON.addType("X", (j: { v: number }) => new X(j.v));

    const s = getDefaultSerializer();
    const encoded = s.stringify({ x: new X(7) });
    const decoded = s.parse<{ x: X }>(encoded);
    expect(decoded.x).toBeInstanceOf(X);
    expect(decoded.x.v).toBe(7);
  });

  it("EJSON API is callable repeatedly without side-effects", () => {
    expect(() => EJSON.stringify({})).not.toThrow();
    expect(() => EJSON.stringify({})).not.toThrow();
  });
});
