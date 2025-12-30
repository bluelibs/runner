// Kept in the tunnel suite to ensure the tunnel serializer wrapper stays
// aligned with GraphSerializer/EJSON. The serializer core tests live in
// src/__tests__/serializer.
import { getDefaultSerializer, serializer, EJSON } from "../../globals/resources/tunnel/serializer";

describe("tunnel serializer coverage", () => {
  it("stringify/parse round-trip and idempotent default getter", () => {
    const s1 = getDefaultSerializer();
    const payload = { when: new Date("2024-01-01T00:00:00.000Z") };
    const text = s1.stringify(payload);
    const parsed = s1.parse(text) as typeof payload;
    expect(parsed.when).toBeInstanceOf(Date);
    expect(parsed.when.getTime()).toBe(payload.when.getTime());
    // Call twice to hit idempotent ensure path
    const s2 = getDefaultSerializer();
    expect(s2).toBe(s1);

    // Exercise serializer methods directly from this module for coverage mapping
    const t2 = serializer.stringify(payload);
    const p2 = serializer.parse(t2) as typeof payload;
    expect(p2.when.getTime()).toBe(payload.when.getTime());

    // EJSON entrypoints remain stable
    expect(typeof EJSON.stringify).toBe("function");
  });
});
