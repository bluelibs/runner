import { defineEvent } from "../../..";
import {
  durableWorkflowTag,
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
});
