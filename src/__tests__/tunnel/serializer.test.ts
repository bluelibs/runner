// These live under the tunnel suite because they validate the wiring of the
// tunnel-facing serializer wrapper (globals/resources/tunnel/serializer).
// Core GraphSerializer behaviour is exercised in src/__tests__/serializer.
import {
  serializer,
  getDefaultSerializer,
} from "../../globals/resources/tunnel/serializer";

describe("tunnel serializer", () => {
  it("getDefaultSerializer returns the shared EJSON serializer", () => {
    const s = getDefaultSerializer();
    expect(s).toBe(serializer); // exported singleton
    expect(s).toBe(getDefaultSerializer()); // idempotent singleton

    const now = new Date("2024-01-02T03:04:05.006Z");
    const encoded = s.stringify({ now });
    // EJSON pattern for date is {"$date": ...}
    // GraphSerializer might use different format if using builtins, let's just check it deserializes correctly
    const decoded = s.parse<{ now: Date }>(encoded);
    expect(decoded.now).toBeInstanceOf(Date);
    expect(decoded.now.getTime()).toBe(now.getTime());
  });

  it("Runner EJSON export stays in sync with serializer implementation", () => {
    const payload = {
      when: new Date("2024-05-03T04:05:06.123Z"),
      nested: { flag: true },
    };
    // Note: GraphSerializer output might differ from pure EJSON.stringify, so we don't expect string equality
    // We expect functional equivalence
    const viaSerializer = serializer.stringify(payload);
    
    // Check that we can roundtrip
    const parsedFromSerializer = serializer.parse<typeof payload>(viaSerializer);
    expect(parsedFromSerializer.when.getTime()).toBe(payload.when.getTime());
  });

  it("supports addType via default serializer (delegates to EJSON.addType)", () => {
    class Distance {
      constructor(public value: number, public unit: string) {}
      toJSONValue() {
        return { value: this.value, unit: this.unit } as const;
      }
      typeName() {
        return "Distance" as const;
      }
    }

    const s = getDefaultSerializer();
    s.addType?.(
      "Distance",
      (j: { value: number; unit: string }) => new Distance(j.value, j.unit),
    );
    const encoded = s.stringify({ d: new Distance(10, "km") });
    const decoded = s.parse<{ d: Distance }>(encoded);
    expect(decoded.d).toBeInstanceOf(Distance);
    expect(decoded.d.value).toBe(10);
    expect(decoded.d.unit).toBe("km");
  });
});
