import { TieredDurableStore } from "../../../../durable/store/tiered/TieredDurableStore";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  createStubAuditEntry,
  createStubExecution,
  createStubSignalRecord,
  createStubStep,
} from "./stub.helpers";

describe("durable: TieredDurableStore reads", () => {
  it("reads live and archived execution data through tiers", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await hot.saveExecution(createStubExecution({ id: "live" }));
    await hot.saveStepResult(
      createStubStep({ executionId: "live", stepId: "step-1" }),
    );
    await hot.appendSignalRecord(
      "live",
      "sig-1",
      createStubSignalRecord({ id: "hot-h" }),
    );
    await cold.saveExecution(createStubExecution({ id: "archived" }));
    await cold.saveStepResult(
      createStubStep({ executionId: "archived", stepId: "step-9" }),
    );
    await cold.appendAuditEntry(
      createStubAuditEntry({ executionId: "archived", id: "cold-audit" }),
    );
    await cold.appendSignalRecord(
      "archived",
      "sig-9",
      createStubSignalRecord({ id: "cold-h" }),
    );
    const tiered = new TieredDurableStore({ hot, cold });

    await expect(tiered.getExecution("live")).resolves.toMatchObject({
      id: "live",
    });
    await expect(tiered.getExecution("archived")).resolves.toMatchObject({
      id: "archived",
    });
    await expect(tiered.getExecution("ghost")).resolves.toBeNull();

    await expect(tiered.getStepResult("live", "step-1")).resolves.toMatchObject(
      { stepId: "step-1" },
    );
    await expect(
      tiered.getStepResult("archived", "step-9"),
    ).resolves.toMatchObject({ stepId: "step-9" });

    await expect(tiered.listStepResults("live")).resolves.toHaveLength(1);
    await expect(tiered.listStepResults("archived")).resolves.toHaveLength(1);

    await expect(tiered.getSignalState("live", "sig-1")).resolves.toMatchObject(
      { signalId: "sig-1" },
    );
    await expect(
      tiered.getSignalState("archived", "sig-9"),
    ).resolves.toMatchObject({ signalId: "sig-9" });

    await expect(tiered.listAuditEntries!("archived")).resolves.toHaveLength(1);
    const journals = await tiered.listSignalStates!("archived");
    expect(journals.map((journal) => journal.signalId)).toEqual(["sig-9"]);
  });
});
