// Kept in the tunnel suite to ensure serializer create/stringify/parse works.
import { Serializer } from "../../serializer";

describe("tunnel serializer coverage", () => {
  it("stringify/parse round-trip across multiple Serializer instances", () => {
    const s1 = new Serializer();
    const payload = { when: new Date("2024-01-01T00:00:00.000Z") };
    const text = s1.stringify(payload);
    const parsed = s1.parse(text) as typeof payload;
    expect(parsed.when).toBeInstanceOf(Date);
    expect(parsed.when.getTime()).toBe(payload.when.getTime());
    // Build another instance to verify constructor path.
    const s2 = new Serializer();
    const secondRoundTrip = s2.parse(s2.stringify(payload)) as typeof payload;
    expect(secondRoundTrip.when.getTime()).toBe(payload.when.getTime());
  });
});
