import { MemoryStore } from "../../../durable/store/MemoryStore";
import type { DurableCommandRecord } from "../../../durable/core/interfaces/commands";
import { pendingExecution } from "../helpers/DurableService.unit.helpers";

const request = (id: string, executionId = "run"): DurableCommandRecord => ({
  id,
  executionId,
  requestedExecutionId: executionId,
  taskKey: "change",
  input: { n: 1 },
  status: "pending",
  createdAt: new Date(0),
});

describe("memory tracked command commits", () => {
  it("admits once, clones payloads, and only permits the FIFO head to commit", async () => {
    const store = new MemoryStore();
    const execution = pendingExecution({ id: "run", historyRecorded: true });
    await store.saveExecution(execution);
    const first = request("one");
    await store.enqueueCommand(first);
    await store.enqueueCommand(request("two"));
    first.input = "mutated";
    expect((await store.enqueueCommand(first)).input).toEqual({ n: 1 });
    expect(
      await store.saveCommand({ ...request("two"), status: "running" }),
    ).toBe(false);
    expect(
      await store.completeCommand({ ...request("two"), status: "failed" }),
    ).toBe(false);
    expect(await store.saveCommand(request("missing"))).toBe(false);
    expect(await store.getCommand("missing")).toBeNull();
    const completed = {
      ...request("one"),
      status: "completed" as const,
      stateInitialized: true,
      state: { value: { count: 1n } },
      result: "done",
      completedAt: new Date(),
    };
    expect(await store.completeCommand(completed)).toBe(false);
    expect(
      await store.completeCommand(completed, { ...execution, attempt: 2 }),
    ).toBe(false);
    expect(await store.completeCommand(completed, execution)).toBe(true);
    expect(await store.getWorkflowState("run")).toMatchObject({
      state: { count: 1n },
    });
    expect(await store.getCommand("one")).toMatchObject({
      status: "completed",
      state: undefined,
    });
    expect(await store.saveCommand(request("one"))).toBe(false);
    expect(await store.completeCommand(completed, execution)).toBe(false);
    expect(
      await store.saveExecutionIfStatus({ ...execution, status: "completed" }, [
        "pending",
      ]),
    ).toBe(false);
    await store.saveExecution({ ...execution, status: "running" });
    expect(
      await store.createContinuedExecution({
        priorExecution: { ...execution, status: "continued_as_new" },
        successorExecution: pendingExecution({ id: "next" }),
      }),
    ).toBe(false);
    expect(
      await store.completeCommand(
        {
          ...request("two"),
          status: "completed",
          stateInitialized: true,
          state: null,
          completedAt: new Date(),
        },
        { ...execution, status: "running" },
      ),
    ).toBe(true);
    expect(await store.getWorkflowState("run")).toBeNull();
    expect(await store.getNextCommand("run")).toBeNull();
    await expect(store.saveCommand(completed)).rejects.toThrow();
    await expect(store.completeCommand(request("bad"))).rejects.toThrow();
  });

  it("rejects closed/version-changed targets and fails receipts without applying private state", async () => {
    const store = new MemoryStore();
    for (const status of ["completed", "cancelling"] as const) {
      await store.saveExecution(pendingExecution({ id: "run", status }));
      await expect(store.enqueueCommand(request("one"))).rejects.toThrow(
        "live execution",
      );
    }
    await expect(
      store.enqueueCommand(request("one", "missing")),
    ).rejects.toThrow("live execution");
    const execution = pendingExecution({ id: "run", workflowVersion: 1 });
    await store.saveExecution(execution);
    await expect(store.enqueueCommand(request("one"))).rejects.toThrow(
      "accepted workflow version",
    );
    const accepted = { ...request("one"), workflowVersion: 1 };
    await store.enqueueCommand(accepted);
    await store.saveWorkflowState({
      executionId: "run",
      state: { n: 5 },
      updatedAt: new Date(),
    });
    await store.saveExecution({ ...execution, status: "cancelled" });
    expect(
      await store.completeCommand(
        { ...accepted, status: "completed" },
        { ...execution, status: "cancelled" },
      ),
    ).toBe(false);
    expect(
      await store.completeCommand({
        ...accepted,
        status: "failed",
        stateInitialized: true,
        state: { value: { n: -1 } },
      }),
    ).toBe(true);
    expect(await store.getWorkflowState("run")).toMatchObject({
      state: { n: 5 },
    });
    await store.saveExecution(execution);
    await store.enqueueCommand({ ...accepted, id: "empty" });
    expect(
      await store.completeCommand(
        { ...accepted, id: "empty", status: "completed" },
        execution,
      ),
    ).toBe(true);
  });

  it("restores pending state, checkpoints and receipts from an isolated snapshot", async () => {
    const store = new MemoryStore();
    await store.saveExecution(pendingExecution({ id: "run" }));
    await store.enqueueCommand(request("one"));
    await store.saveCommand({
      ...request("one"),
      status: "running",
      stateInitialized: true,
      state: { value: { cursor: 5 } },
    });
    await store.recordExecutionHistory("run", {
      stepId: "prepare",
      kind: "step",
      phase: "started",
    });
    const recovered = new MemoryStore();
    recovered.restoreSnapshot(store.exportSnapshot());
    expect(await recovered.getNextCommand("run")).toMatchObject({
      status: "running",
      state: { value: { cursor: 5 } },
    });
    expect(await recovered.listExecutionHistory("run")).toMatchObject([
      { stepId: "prepare" },
    ]);
    await recovered.completeCommand({ ...request("one"), status: "failed" });
    expect(await store.getNextCommand("run")).not.toBeNull();
  });
  it("preserves monotonic ordering when a raw backend branch includes a frontier record", async () => {
    const store = new MemoryStore();
    const expected = pendingExecution({ id: "source", status: "paused" });
    await store.saveExecution(expected);
    const branch = {
      expected,
      execution: pendingExecution({ id: "new" }),
      state: null,
      steps: [],
      history: [{ stepId: "frontier", kind: "step" as const, startedOrder: 5 }],
    };
    expect(await store.createCheckpointExecution(branch)).toBe(true);
    expect(await store.createCheckpointExecution(branch)).toBe(false);
    await store.recordExecutionHistory("new", {
      stepId: "frontier",
      kind: "step",
      phase: "completed",
    });
    expect((await store.listExecutionHistory("new"))[0].completedOrder).toBe(6);
  });
});
