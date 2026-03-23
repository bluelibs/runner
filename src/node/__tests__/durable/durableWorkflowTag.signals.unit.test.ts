import { defineEvent } from "../../..";
import {
  durableWorkflowTag,
  getDurableWorkflowKey,
  getDeclaredDurableWorkflowSignalIds,
} from "../../durable/tags/durableWorkflow.tag";

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
});
