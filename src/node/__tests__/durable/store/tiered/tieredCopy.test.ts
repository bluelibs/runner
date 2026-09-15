import {
  copyExecutionData,
  countExecutionData,
  requireExecutionDataDeletion,
  sameExecutionDataCounts,
  type ExecutionDataCounts,
} from "../../../../durable/store/tiered/tieredCopy";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  createStubAuditEntry,
  createStubExecution,
  createStubQueuedSignalRecord,
  createStubSignalRecord,
  createStubStep,
  createStubStore,
} from "./stub.helpers";

function counts(overrides?: Partial<ExecutionDataCounts>): ExecutionDataCounts {
  return {
    steps: 1,
    audit: 1,
    journals: [{ signalId: "sig-1", queued: 1, history: 2 }],
    ...overrides,
  };
}

describe("durable: tiered copy", () => {
  it("copies execution history between stores", async () => {
    const source = new MemoryStore();
    const dest = new MemoryStore();
    await source.saveExecution(createStubExecution());
    await source.saveStepResult(createStubStep({ stepId: "step-1" }));
    await source.saveStepResult(createStubStep({ stepId: "step-2" }));
    await source.appendAuditEntry(createStubAuditEntry({ id: "audit-1" }));
    await source.appendAuditEntry(createStubAuditEntry({ id: "audit-2" }));
    await source.appendSignalRecord(
      "exec-1",
      "sig-1",
      createStubSignalRecord({ id: "h1" }),
    );
    await source.appendSignalRecord(
      "exec-1",
      "sig-1",
      createStubSignalRecord({ id: "h2" }),
    );
    await source.enqueueQueuedSignalRecord(
      "exec-1",
      "sig-1",
      createStubQueuedSignalRecord({ id: "q1" }),
    );

    const copied = await copyExecutionData({
      source,
      dest,
      executionId: "exec-1",
    });

    expect(copied).toEqual({
      steps: 2,
      audit: 2,
      journals: [{ signalId: "sig-1", queued: 1, history: 2 }],
    });
    await expect(dest.getExecution("exec-1")).resolves.toMatchObject({
      id: "exec-1",
      status: "completed",
    });
    const steps = await dest.listStepResults("exec-1");
    expect(steps.map((step) => step.stepId).sort()).toEqual([
      "step-1",
      "step-2",
    ]);
    const audit = await dest.listAuditEntries("exec-1");
    expect(audit.map((entry) => entry.id).sort()).toEqual([
      "audit-1",
      "audit-2",
    ]);
    const journal = await dest.getSignalState("exec-1", "sig-1");
    expect(journal?.history.map((record) => record.id)).toEqual(["h1", "h2"]);
    expect(journal?.queued.map((record) => record.id)).toEqual(["q1"]);
  });

  it("refuses to copy a missing execution", async () => {
    const source = new MemoryStore();
    const dest = new MemoryStore();

    await expect(
      copyExecutionData({ source, dest, executionId: "ghost" }),
    ).rejects.toThrow(
      "Cannot copy durable execution 'ghost': it is missing from the source store.",
    );
  });

  it("requires audit support on dest only when entries exist", async () => {
    const source = new MemoryStore();
    const bareDest = createStubStore({ without: ["appendAuditEntry"] });
    await source.saveExecution(createStubExecution());
    await source.appendAuditEntry(createStubAuditEntry());

    await expect(
      copyExecutionData({ source, dest: bareDest, executionId: "exec-1" }),
    ).rejects.toThrow("Store does not support appendAuditEntry");

    const emptySource = new MemoryStore();
    await emptySource.saveExecution(createStubExecution());
    await expect(
      copyExecutionData({
        source: emptySource,
        dest: bareDest,
        executionId: "exec-1",
      }),
    ).resolves.toMatchObject({ audit: 0 });
    await expect(bareDest.getExecution("exec-1")).resolves.toMatchObject({
      id: "exec-1",
    });
  });

  it("skips audit and journals the source cannot list", async () => {
    const source = createStubStore({
      without: ["listAuditEntries", "listSignalStates"],
    });
    const dest = new MemoryStore();
    await source.saveExecution(createStubExecution());
    await source.saveStepResult(createStubStep());

    const copied = await copyExecutionData({
      source,
      dest,
      executionId: "exec-1",
    });

    expect(copied).toEqual({ steps: 1, audit: 0, journals: [] });
  });

  it("counts execution data with and without optional listings", async () => {
    const full = new MemoryStore();
    await full.saveExecution(createStubExecution());
    await full.saveStepResult(createStubStep());
    await full.appendAuditEntry(createStubAuditEntry());
    await full.appendSignalRecord("exec-1", "sig-1", createStubSignalRecord());

    await expect(countExecutionData(full, "exec-1")).resolves.toEqual({
      steps: 1,
      audit: 1,
      journals: [{ signalId: "sig-1", queued: 0, history: 1 }],
    });

    const bare = createStubStore({
      without: ["listAuditEntries", "listSignalStates"],
    });
    await bare.saveExecution(createStubExecution());
    await expect(countExecutionData(bare, "exec-1")).resolves.toEqual({
      steps: 0,
      audit: 0,
      journals: [],
    });
  });

  it.each([
    ["equal counts", counts(), counts(), true],
    ["steps differ", counts(), counts({ steps: 2 }), false],
    ["audit differ", counts(), counts({ audit: 0 }), false],
    ["journal count differs", counts(), counts({ journals: [] }), false],
    [
      "signal differs",
      counts(),
      counts({ journals: [{ signalId: "other", queued: 1, history: 2 }] }),
      false,
    ],
    [
      "queued differs",
      counts(),
      counts({ journals: [{ signalId: "sig-1", queued: 0, history: 2 }] }),
      false,
    ],
    [
      "history differs",
      counts(),
      counts({ journals: [{ signalId: "sig-1", queued: 1, history: 0 }] }),
      false,
    ],
  ])("compares counts: %s", (_name, left, right, expected) => {
    expect(sameExecutionDataCounts(left, right)).toBe(expected);
  });

  it("requires deleteExecutionData naming the tier", async () => {
    const store = new MemoryStore();
    await store.saveExecution(createStubExecution());
    const deleter = requireExecutionDataDeletion(store, "hot");
    await deleter("exec-1");
    await expect(store.getExecution("exec-1")).resolves.toBeNull();

    const bare = createStubStore({ without: ["deleteExecutionData"] });
    expect(() => requireExecutionDataDeletion(bare, "hot")).toThrow(
      "Store does not support deleteExecutionData (hot store)",
    );
    expect(() => requireExecutionDataDeletion(bare, "cold")).toThrow(
      "Store does not support deleteExecutionData (cold store)",
    );
  });
});
