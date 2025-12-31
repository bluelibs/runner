// These live under the tunnel suite because they validate the default serializer
// singleton and the stable stringify/parse/addType surface used by tunnels.
import { getDefaultSerializer, Serializer } from "../../serializer";

describe("tunnel serializer", () => {
  it("getDefaultSerializer returns a shared serializer singleton", () => {
    const s = getDefaultSerializer();
    expect(s).toBe(getDefaultSerializer()); // idempotent singleton

    const now = new Date("2024-01-02T03:04:05.006Z");
    const encoded = s.stringify({ now });
    const decoded = s.parse<{ now: Date }>(encoded);
    expect(decoded.now).toBeInstanceOf(Date);
    expect(decoded.now.getTime()).toBe(now.getTime());
  });

  it("round-trips payloads via stringify/parse", () => {
    const payload = {
      when: new Date("2024-05-03T04:05:06.123Z"),
      nested: { flag: true },
    };
    const s = getDefaultSerializer();
    const viaSerializer = s.stringify(payload);

    // Check that we can roundtrip
    const parsedFromSerializer = s.parse<typeof payload>(viaSerializer);
    expect(parsedFromSerializer.when.getTime()).toBe(payload.when.getTime());
  });

  it("supports addType(name, factory) with typeName()/toJSONValue() value types", () => {
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

    const s = getDefaultSerializer();
    s.addType(
      "Distance",
      (j: { value: number; unit: string }) => new Distance(j.value, j.unit),
    );
    const encoded = s.stringify({ d: new Distance(10, "km") });
    const decoded = s.parse<{ d: Distance }>(encoded);
    expect(decoded.d).toBeInstanceOf(Distance);
    expect(decoded.d.value).toBe(10);
    expect(decoded.d.unit).toBe("km");
  });

  it("supports addType(typeDefinition) directly", () => {
    const s = new Serializer();
    s.addType({
      id: "Token",
      is: (obj: unknown): obj is string =>
        typeof obj === "string" && obj.startsWith("T:"),
      serialize: (v) => v,
      deserialize: (v) => v,
      strategy: "value",
    });
    expect(s.parse(s.stringify({ v: "T:1" }))).toEqual({ v: "T:1" });
  });
});
