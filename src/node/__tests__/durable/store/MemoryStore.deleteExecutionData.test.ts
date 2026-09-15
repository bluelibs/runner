import { ExecutionStatus } from "../../../durable/core/types";
import { MemoryStore } from "../../../durable/store/MemoryStore";
import {
  createStubAuditEntry,
  createStubExecution,
  createStubSignalRecord,
  createStubStep,
} from "./tiered/stub.helpers";

describe("durable: MemoryStore.deleteExecutionData", () => {
  it("deletes history while keeping live runtime state", async () => {
    const store = new MemoryStore();
    await store.createExecutionWithIdempotencyKey({
      execution: createStubExecution({ id: "exec-1" }),
      workflowKey: "workflow-1",
      idempotencyKey: "key-1",
    });
    await store.saveStepResult(createStubStep());
    await store.appendAuditEntry(createStubAuditEntry());
    await store.appendSignalRecord("exec-1", "sig-1", createStubSignalRecord());
    await store.upsertSignalWaiter({
      executionId: "exec-1",
      signalId: "sig-1",
      stepId: "step-wait",
      sortKey: "a",
    });
    await store.upsertExecutionWaiter({
      executionId: "parent-1",
      targetExecutionId: "exec-1",
      stepId: "step-wait",
    });
    await store.createTimer({
      id: "timer-1",
      executionId: "exec-1",
      type: "sleep",
      fireAt: new Date("2024-01-01T00:00:00.000Z"),
      status: "pending",
    });

    await store.deleteExecutionData("exec-1");

    await expect(store.getExecution("exec-1")).resolves.toBeNull();
    await expect(store.listStepResults("exec-1")).resolves.toEqual([]);
    await expect(store.listAuditEntries("exec-1")).resolves.toEqual([]);
    await expect(store.getSignalState("exec-1", "sig-1")).resolves.toBeNull();
    await expect(store.listSignalStates("exec-1")).resolves.toEqual([]);

    await expect(
      store.peekNextSignalWaiter("exec-1", "sig-1"),
    ).resolves.not.toBeNull();
    await expect(store.listExecutionWaiters("exec-1")).resolves.toHaveLength(1);
    await expect(store.getReadyTimers(new Date())).resolves.toHaveLength(1);
    await expect(
      store.createExecutionWithIdempotencyKey({
        execution: createStubExecution({ id: "exec-2" }),
        workflowKey: "workflow-1",
        idempotencyKey: "key-1",
      }),
    ).resolves.toMatchObject({ created: false, executionId: "exec-1" });
  });

  it("is a no-op for unknown executions", async () => {
    const store = new MemoryStore();

    await expect(store.deleteExecutionData("ghost")).resolves.toBeUndefined();
  });

  it("deletes partial leftovers without an execution record", async () => {
    const store = new MemoryStore();
    await store.saveStepResult(
      createStubStep({ executionId: "orphan", stepId: "step-1" }),
    );

    await store.deleteExecutionData("orphan");

    await expect(store.listStepResults("orphan")).resolves.toEqual([]);
    expect(
      (await store.listExecutions()).some(
        (execution) => execution.status === ExecutionStatus.Completed,
      ),
    ).toBe(false);
  });
});
