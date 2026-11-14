import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { DurableOperator } from "../../../../durable/core/DurableOperator";
import { prepareCheckpointBranch } from "../../../../durable/core/checkpointReset";
import type { DurableReplayFixture } from "../../../../durable/core/interfaces/history";
import { pendingExecution } from "../../helpers/DurableService.unit.helpers";

async function fixture(store: MemoryStore): Promise<DurableReplayFixture> {
  await store.saveExecution(
    pendingExecution({
      id: "source",
      status: "paused",
      historyRecorded: true,
      workflowVersion: 2,
      retention: { onComplete: "retain" },
    }),
  );
  await store.recordExecutionHistory("source", {
    stepId: "__origin",
    kind: "origin",
    phase: "completed",
    stateAfter: null,
  });
  await store.recordExecutionHistory("source", {
    stepId: "charge",
    kind: "step",
    phase: "started",
  });
  return new DurableOperator(store).exportReplay("source");
}
const options = { beforeStep: "charge", reason: "Repair payment" };

describe("checkpoint branch safety", () => {
  it("rejects legacy, collected, live, nested and overlapping prefixes", async () => {
    const store = new MemoryStore();
    const operator = new DurableOperator(store);
    await expect(operator.exportReplay("missing")).rejects.toThrow(
      "recorded replay history",
    );
    await store.saveExecution(
      pendingExecution({ id: "source", historyRecorded: true }),
    );
    await expect(operator.exportReplay("source")).rejects.toThrow("origin");
    const saved = await fixture(store);
    expect(() =>
      prepareCheckpointBranch(
        { ...saved, execution: { ...saved.execution, status: "running" } },
        "new",
        options,
      ),
    ).toThrow("Pause");
    for (const beforeStep of ["missing", "__origin"])
      expect(() =>
        prepareCheckpointBranch(saved, "new", { ...options, beforeStep }),
      ).toThrow("top-level");
    const nested = structuredClone(saved);
    nested.history[1].parentStepId = "parent";
    expect(() => prepareCheckpointBranch(nested, "new", options)).toThrow(
      "top-level",
    );
    const overlapping = structuredClone(saved);
    overlapping.history[0].completedOrder = undefined;
    expect(() => prepareCheckpointBranch(overlapping, "new", options)).toThrow(
      "overlapping",
    );
    overlapping.history[0].completedOrder = 99;
    expect(() => prepareCheckpointBranch(overlapping, "new", options)).toThrow(
      "overlapping",
    );
    await expect(
      operator.reset("source", { ...options, reason: "" }),
    ).rejects.toThrow();
    const lock = await store.acquireLock("execution:source", 30000);
    await expect(operator.reset("source", options)).rejects.toThrow(
      "still owned",
    );
    await expect(operator.exportReplay("source")).rejects.toThrow(
      "still owned",
    );
    await store.releaseLock("execution:source", lock!);
    const branch = await operator.reset("source", options);
    expect(await store.getWorkflowState(branch)).toBeNull();
    expect((await store.getExecution(branch))?.workflowVersion).toBe(2);
    expect((await store.getExecution(branch))?.retention).toEqual({
      onComplete: "retain",
    });
  });

  it("fails closed when source ownership or its snapshot changes", async () => {
    const store = new MemoryStore();
    await fixture(store);
    const create = jest.spyOn(store, "createCheckpointExecution");
    create.mockResolvedValueOnce(false);
    await expect(
      new DurableOperator(store).reset("source", options),
    ).rejects.toThrow("Source changed");
    create.mockImplementationOnce(async () => {
      const snapshot = store.exportSnapshot();
      store.restoreSnapshot(snapshot);
      return MemoryStore.prototype.createCheckpointExecution.call(
        store,
        prepareCheckpointBranch(
          await fixture(new MemoryStore()),
          "bad",
          options,
        ),
      );
    });
    await expect(
      new DurableOperator(store).reset("source", options),
    ).rejects.toThrow("lost source");
  });

  it("rejects unsupported adapters without changing the original execution", async () => {
    const store = new MemoryStore();
    await fixture(store);
    const custom = Object.create(store) as MemoryStore;
    Object.defineProperty(custom, "createCheckpointExecution", {
      value: undefined,
    });
    await expect(
      new DurableOperator(custom).reset("source", options),
    ).rejects.toThrow("atomic checkpoint");
    Object.defineProperty(custom, "withExecutionOwnership", {
      value: undefined,
    });
    await expect(
      new DurableOperator(custom).exportReplay("source"),
    ).rejects.toThrow("renewable atomic");
    const branch = prepareCheckpointBranch(
      await fixture(new MemoryStore()),
      "new",
      options,
    );
    await store.saveExecution({ ...branch.expected, attempt: 2 });
    expect(await store.createCheckpointExecution(branch)).toBe(false);
  });
});
