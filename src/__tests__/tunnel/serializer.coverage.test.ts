// Kept in the tunnel suite to ensure the default serializer singleton is stable.
import { getDefaultSerializer } from "../../serializer";

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
  });
});
