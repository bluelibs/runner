import { defineEvent } from "../../../..";
import {
  durableWorkflowTag,
  getDurableWorkflowConcurrency,
  getDurableWorkflowKey,
  getDeclaredDurableWorkflowSignalIds,
} from "../../../durable/tags/durableWorkflow.tag";

describe("durable: durableWorkflowTag signals", () => {
  it("fails fast when configured signal ids are duplicated", () => {
    const Approved = defineEvent<{ ok: true }>({ id: "approved" });
    const ApprovedAgain = defineEvent<{ ok: false }>({ id: "approved" });

    expect(() =>
      durableWorkflowTag.with({
        category: "orders",
        signals: [Approved, ApprovedAgain],
      }),
    ).toThrow("unique local signal ids");
  });

  it("returns null when no task is provided", () => {
    expect(getDeclaredDurableWorkflowSignalIds(undefined)).toBeNull();
  });

  it("resolves the durable workflow key from tag key, canonical id, or task id fallback", () => {
    expect(getDurableWorkflowKey(undefined, "canonical.orders")).toBe(
      "canonical.orders",
    );

    expect(
      getDurableWorkflowKey(
        {
          id: "local-orders",
          tags: [
            durableWorkflowTag.with({ category: "orders", key: "orders" }),
          ],
        },
        "canonical.orders",
      ),
    ).toBe("orders");

    expect(
      getDurableWorkflowKey(
        {
          id: "local-orders",
          tags: [durableWorkflowTag.with({ category: "orders" })],
        },
        undefined,
      ),
    ).toBe("local-orders");
  });

  it("accepts global concurrency and fixed-window rate-limit policies", () => {
    expect(
      getDurableWorkflowConcurrency({
        id: "serial",
        tags: [durableWorkflowTag.with({ concurrency: 1 })],
      }),
    ).toBe(1);

    expect(
      getDurableWorkflowConcurrency({
        id: "rate-limited",
        tags: [
          durableWorkflowTag.with({
            concurrency: { windowMs: 60_000, max: 100 },
          }),
        ],
      }),
    ).toEqual({ windowMs: 60_000, max: 100 });
    expect(getDurableWorkflowConcurrency(undefined)).toBeUndefined();
  });

  it.each([
    0,
    -1,
    1.5,
    { windowMs: 0, max: 1 },
    { windowMs: 1_000, max: 0 },
    { windowMs: 1.5, max: 1 },
  ])("rejects invalid workflow admission policy %p", (concurrency) => {
    expect(() =>
      durableWorkflowTag.with({
        concurrency: concurrency as 1,
      }),
    ).toThrow();
  });
});
