import {
  listAuditEntriesThroughTiers,
  listSignalStatesThroughTiers,
  listStepResultsThroughTiers,
  mergeAuditEntries,
  mergeSignalStates,
  mergeStepResults,
  readExecutionThroughTiers,
  readSignalStateThroughTiers,
  readStepResultThroughTiers,
} from "../../../../durable/store/tiered/tieredReads";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  createStubAuditEntry,
  createStubExecution,
  createStubQueuedSignalRecord,
  createStubSignalRecord,
  createStubStep,
  createStubStore,
} from "./stub.helpers";

describe("durable: tiered reads", () => {
  it("merges step results with hot winning per step", () => {
    const merged = mergeStepResults(
      [
        createStubStep({ stepId: "step-1", result: "hot" }),
        createStubStep({ stepId: "step-3", result: "hot-only" }),
      ],
      [
        createStubStep({ stepId: "step-1", result: "cold" }),
        createStubStep({ stepId: "step-2", result: "cold" }),
      ],
    );

    expect(merged.map((step) => step.stepId)).toEqual([
      "step-1",
      "step-2",
      "step-3",
    ]);
    expect(merged[0]?.result).toBe("hot");
  });

  it("merges audit trails cold-first with id dedupe", () => {
    const merged = mergeAuditEntries(
      [
        createStubAuditEntry({ id: "audit-1", message: "hot-copy" }),
        createStubAuditEntry({ id: "audit-3", message: "hot-only" }),
      ],
      [
        createStubAuditEntry({ id: "audit-1", message: "cold" }),
        createStubAuditEntry({ id: "audit-2", message: "cold" }),
      ],
    );

    expect(merged.map((entry) => entry.id)).toEqual([
      "audit-1",
      "audit-2",
      "audit-3",
    ]);
  });

  it("merges signal journals with hot winning per signal", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await hot.appendSignalRecord(
      "exec-1",
      "sig-1",
      createStubSignalRecord({ id: "hot-h" }),
    );
    await cold.appendSignalRecord(
      "exec-1",
      "sig-1",
      createStubSignalRecord({ id: "cold-h" }),
    );
    await cold.appendSignalRecord(
      "exec-1",
      "sig-2",
      createStubSignalRecord({ id: "cold-only" }),
    );

    const merged = mergeSignalStates(
      await hot.listSignalStates("exec-1"),
      await cold.listSignalStates("exec-1"),
    );

    expect(merged.map((state) => state.signalId)).toEqual(["sig-1", "sig-2"]);
    expect(merged[0]?.history.map((record) => record.id)).toEqual(["hot-h"]);
  });

  it("reads executions hot-first with cold fallback", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await hot.saveExecution(createStubExecution({ id: "hot-exec" }));
    await cold.saveExecution(createStubExecution({ id: "cold-exec" }));

    await expect(
      readExecutionThroughTiers(hot, cold, "hot-exec"),
    ).resolves.toMatchObject({ id: "hot-exec" });
    await expect(
      readExecutionThroughTiers(hot, cold, "cold-exec"),
    ).resolves.toMatchObject({ id: "cold-exec" });
    await expect(
      readExecutionThroughTiers(hot, cold, "ghost"),
    ).resolves.toBeNull();
  });

  it("reads step results without consulting cold for live executions", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await hot.saveExecution(createStubExecution({ id: "live" }));
    await hot.saveStepResult(
      createStubStep({ executionId: "live", stepId: "step-1" }),
    );
    await cold.saveStepResult(
      createStubStep({ executionId: "archived", stepId: "step-9" }),
    );
    const coldGetSpy = jest.spyOn(cold, "getStepResult");

    await expect(
      readStepResultThroughTiers(hot, cold, "live", "step-1"),
    ).resolves.toMatchObject({ stepId: "step-1" });
    await expect(
      readStepResultThroughTiers(hot, cold, "live", "missing"),
    ).resolves.toBeNull();
    expect(coldGetSpy).not.toHaveBeenCalled();

    await expect(
      readStepResultThroughTiers(hot, cold, "archived", "step-9"),
    ).resolves.toMatchObject({ stepId: "step-9" });
    await expect(
      readStepResultThroughTiers(hot, cold, "archived", "missing"),
    ).resolves.toBeNull();
    expect(coldGetSpy).toHaveBeenCalledTimes(2);
  });

  it("lists step results from hot for live executions", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await hot.saveExecution(createStubExecution({ id: "live" }));
    await hot.saveStepResult(
      createStubStep({ executionId: "live", stepId: "step-1" }),
    );
    await cold.saveStepResult(
      createStubStep({ executionId: "live", stepId: "step-cold" }),
    );
    const coldListSpy = jest.spyOn(cold, "listStepResults");

    const steps = await listStepResultsThroughTiers(hot, cold, "live");

    expect(steps.map((step) => step.stepId)).toEqual(["step-1"]);
    expect(coldListSpy).not.toHaveBeenCalled();
  });

  it("merges step results for executions unknown to hot", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await hot.saveStepResult(
      createStubStep({ executionId: "archived", stepId: "step-1" }),
    );
    await cold.saveStepResult(
      createStubStep({ executionId: "archived", stepId: "step-2" }),
    );

    const steps = await listStepResultsThroughTiers(hot, cold, "archived");

    expect(steps.map((step) => step.stepId).sort()).toEqual([
      "step-1",
      "step-2",
    ]);
  });

  it("lists audit entries per tier capabilities", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await hot.saveExecution(createStubExecution({ id: "live" }));
    await hot.appendAuditEntry(
      createStubAuditEntry({ executionId: "live", id: "hot-audit" }),
    );

    await expect(
      listAuditEntriesThroughTiers(hot, cold, "live"),
    ).resolves.toHaveLength(1);

    const bareHot = createStubStore({ without: ["listAuditEntries"] });
    await bareHot.saveExecution(createStubExecution({ id: "live" }));
    await expect(
      listAuditEntriesThroughTiers(bareHot, cold, "live"),
    ).resolves.toEqual([]);

    await cold.appendAuditEntry(
      createStubAuditEntry({ executionId: "archived", id: "cold-audit" }),
    );
    await hot.appendAuditEntry(
      createStubAuditEntry({ executionId: "archived", id: "hot-audit" }),
    );
    const merged = await listAuditEntriesThroughTiers(hot, cold, "archived");
    expect(merged.map((entry) => entry.id)).toEqual([
      "cold-audit",
      "hot-audit",
    ]);

    const bareCold = createStubStore({ without: ["listAuditEntries"] });
    await expect(
      listAuditEntriesThroughTiers(bareHot, bareCold, "archived"),
    ).resolves.toEqual([]);
  });

  it("reads signal journals hot-first with cold fallback", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await hot.saveExecution(createStubExecution({ id: "live" }));
    await hot.appendSignalRecord(
      "live",
      "sig-1",
      createStubSignalRecord({ id: "hot-h" }),
    );
    await cold.appendSignalRecord(
      "archived",
      "sig-1",
      createStubSignalRecord({ id: "cold-h" }),
    );
    const coldGetSpy = jest.spyOn(cold, "getSignalState");

    await expect(
      readSignalStateThroughTiers(hot, cold, "live", "sig-1"),
    ).resolves.toMatchObject({ signalId: "sig-1" });
    await expect(
      readSignalStateThroughTiers(hot, cold, "live", "missing"),
    ).resolves.toBeNull();
    expect(coldGetSpy).not.toHaveBeenCalled();

    await expect(
      readSignalStateThroughTiers(hot, cold, "archived", "sig-1"),
    ).resolves.toMatchObject({ signalId: "sig-1" });
    await expect(
      readSignalStateThroughTiers(hot, cold, "archived", "missing"),
    ).resolves.toBeNull();
  });

  it("lists signal journals per tier capabilities", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await hot.saveExecution(createStubExecution({ id: "live" }));
    await hot.appendSignalRecord(
      "live",
      "sig-1",
      createStubSignalRecord({ id: "hot-h" }),
    );

    await expect(
      listSignalStatesThroughTiers(hot, cold, "live"),
    ).resolves.toHaveLength(1);

    const bareHot = createStubStore({ without: ["listSignalStates"] });
    await bareHot.saveExecution(createStubExecution({ id: "live" }));
    await expect(
      listSignalStatesThroughTiers(bareHot, cold, "live"),
    ).resolves.toEqual([]);

    await cold.enqueueQueuedSignalRecord(
      "archived",
      "sig-9",
      createStubQueuedSignalRecord({ id: "cold-q" }),
    );
    const merged = await listSignalStatesThroughTiers(hot, cold, "archived");
    expect(merged.map((state) => state.signalId)).toEqual(["sig-9"]);

    const bareCold = createStubStore({ without: ["listSignalStates"] });
    await expect(
      listSignalStatesThroughTiers(bareHot, bareCold, "archived"),
    ).resolves.toEqual([]);
  });
});
