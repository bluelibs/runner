import {
  createDurableAuditEntryId,
  isDurableInternalStepId,
} from "../core/audit";

describe("durable: audit helpers", () => {
  it("detects internal step ids", () => {
    expect(isDurableInternalStepId("__sleep:0")).toBe(true);
    expect(isDurableInternalStepId("rollback:s1")).toBe(true);
    expect(isDurableInternalStepId("user.step")).toBe(false);
  });

  it("generates sortable audit entry ids", () => {
    const id = createDurableAuditEntryId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(10);
    expect(id).toContain(":");

    const fixed = createDurableAuditEntryId(123);
    expect(fixed.startsWith("123:")).toBe(true);
  });
});
