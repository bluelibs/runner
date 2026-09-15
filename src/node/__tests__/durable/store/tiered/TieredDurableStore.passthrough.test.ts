import { ExecutionStatus } from "../../../../durable/core/types";
import { TieredDurableStore } from "../../../../durable/store/tiered/TieredDurableStore";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  createFnStore,
  createStubExecution,
  createStubQueuedSignalRecord,
  createStubSignalRecord,
  createStubStep,
  STUB_NOW,
} from "./stub.helpers";

describe("durable: TieredDurableStore hot passthrough", () => {
  it("keeps execution writes and listings on hot", async () => {
    const hot = new MemoryStore();
    const cold = createFnStore();
    const tiered = new TieredDurableStore({ hot, cold });
    const execution = createStubExecution({
      id: "exec-1",
      status: ExecutionStatus.Running,
    });

    await tiered.saveExecution(execution);
    await expect(
      tiered.saveExecutionIfStatus(
        { ...execution, status: ExecutionStatus.Sleeping },
        [ExecutionStatus.Running],
      ),
    ).resolves.toBe(true);
    await tiered.updateExecution("exec-1", { attempt: 2 });
    await expect(tiered.listIncompleteExecutions()).resolves.toHaveLength(1);
    await expect(
      tiered.createExecutionWithIdempotencyKey({
        execution: createStubExecution({ id: "exec-2" }),
        workflowKey: "workflow-1",
        idempotencyKey: "key-1",
      }),
    ).resolves.toMatchObject({ created: true });
    await expect(
      tiered.createExecutionWithIdempotencyKey({
        execution: createStubExecution({ id: "exec-3" }),
        workflowKey: "workflow-1",
        idempotencyKey: "key-1",
      }),
    ).resolves.toMatchObject({ created: false, executionId: "exec-2" });
    await expect(tiered.listExecutions()).resolves.toHaveLength(2);
    await tiered.saveStepResult(createStubStep());

    await expect(hot.getExecution("exec-1")).resolves.toMatchObject({
      status: "sleeping",
      attempt: 2,
    });
    expect(cold.saveExecution).not.toHaveBeenCalled();
    expect(cold.saveStepResult).not.toHaveBeenCalled();
    expect(cold.listExecutions).not.toHaveBeenCalled();
    expect(cold.listIncompleteExecutions).not.toHaveBeenCalled();
  });

  it("keeps live signal operations on hot", async () => {
    const hot = new MemoryStore();
    const cold = createFnStore();
    const tiered = new TieredDurableStore({ hot, cold });

    await tiered.appendSignalRecord(
      "exec-1",
      "sig-1",
      createStubSignalRecord({ id: "h1" }),
    );
    await tiered.bufferSignalRecord(
      "exec-1",
      "sig-1",
      createStubQueuedSignalRecord({ id: "q1" }),
    );
    await tiered.enqueueQueuedSignalRecord(
      "exec-1",
      "sig-1",
      createStubQueuedSignalRecord({ id: "q2" }),
    );
    await expect(
      tiered.consumeQueuedSignalRecord("exec-1", "sig-1"),
    ).resolves.toMatchObject({ id: "q1" });
    await expect(
      tiered.consumeBufferedSignalForStep({
        executionId: "exec-1",
        stepId: "step-signal",
        result: { signalId: "sig-1", state: "completed" },
        completedAt: STUB_NOW,
      }),
    ).resolves.toMatchObject({ id: "q2" });

    const journal = await hot.getSignalState("exec-1", "sig-1");
    expect(journal?.history).toHaveLength(2);
    expect(journal?.queued).toHaveLength(0);
    expect(cold.appendSignalRecord).not.toHaveBeenCalled();
    expect(cold.enqueueQueuedSignalRecord).not.toHaveBeenCalled();
  });

  it("keeps waiter indexes on hot", async () => {
    const hot = new MemoryStore();
    const cold = createFnStore();
    const tiered = new TieredDurableStore({ hot, cold });

    await tiered.upsertSignalWaiter({
      executionId: "exec-1",
      signalId: "sig-1",
      stepId: "step-1",
      sortKey: "a",
    });
    await expect(
      tiered.peekNextSignalWaiter("exec-1", "sig-1"),
    ).resolves.toMatchObject({ stepId: "step-1" });
    await expect(
      tiered.takeNextSignalWaiter("exec-1", "sig-1"),
    ).resolves.toMatchObject({ stepId: "step-1" });
    await tiered.upsertSignalWaiter({
      executionId: "exec-1",
      signalId: "sig-1",
      stepId: "step-2",
      sortKey: "b",
    });
    await tiered.deleteSignalWaiter("exec-1", "sig-1", "step-2");
    await expect(
      tiered.peekNextSignalWaiter("exec-1", "sig-1"),
    ).resolves.toBeNull();

    await tiered.upsertExecutionWaiter({
      executionId: "parent-1",
      targetExecutionId: "child-1",
      stepId: "step-wait",
    });
    await expect(tiered.listExecutionWaiters("child-1")).resolves.toHaveLength(
      1,
    );
    await tiered.deleteExecutionWaiter("child-1", "parent-1", "step-wait");
    await expect(tiered.listExecutionWaiters("child-1")).resolves.toHaveLength(
      0,
    );

    expect(cold.upsertSignalWaiter).not.toHaveBeenCalled();
    expect(cold.upsertExecutionWaiter).not.toHaveBeenCalled();
  });

  it("keeps timers and schedules on hot", async () => {
    const hot = new MemoryStore();
    const cold = createFnStore();
    const tiered = new TieredDurableStore({ hot, cold });
    const past = new Date("2024-01-01T00:00:00.000Z");

    await tiered.createTimer({
      id: "timer-1",
      type: "sleep",
      fireAt: past,
      status: "pending",
    });
    await expect(tiered.getReadyTimers(new Date())).resolves.toHaveLength(1);
    await expect(
      tiered.claimReadyTimers(new Date(), 10, "worker-1", 1000),
    ).resolves.toHaveLength(1);
    await tiered.markTimerFired("timer-1");
    await tiered.deleteTimer("timer-1");
    await expect(tiered.getReadyTimers()).resolves.toHaveLength(0);

    const schedule = {
      id: "schedule-1",
      workflowKey: "workflow-1",
      type: "interval" as const,
      pattern: "1000",
      input: undefined,
      status: "active" as const,
      createdAt: past,
      updatedAt: past,
    };
    await tiered.createSchedule(schedule);
    await expect(tiered.getSchedule("schedule-1")).resolves.toMatchObject({
      id: "schedule-1",
    });
    await tiered.updateSchedule("schedule-1", { pattern: "2000" });
    await tiered.saveScheduleWithTimer(
      { ...(await hot.getSchedule("schedule-1"))!, updatedAt: past },
      { id: "timer-s", type: "scheduled", fireAt: past, status: "pending" },
    );
    await expect(tiered.listSchedules()).resolves.toHaveLength(1);
    await expect(tiered.listActiveSchedules()).resolves.toHaveLength(1);
    await tiered.deleteSchedule("schedule-1");
    await expect(tiered.listSchedules()).resolves.toHaveLength(0);

    expect(cold.createTimer).not.toHaveBeenCalled();
    expect(cold.createSchedule).not.toHaveBeenCalled();
  });

  it("lists stuck executions from hot only", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await hot.saveExecution(
      createStubExecution({
        id: "hot-stuck",
        status: ExecutionStatus.CompensationFailed,
      }),
    );
    await cold.saveExecution(
      createStubExecution({
        id: "cold-stuck",
        status: ExecutionStatus.CompensationFailed,
      }),
    );
    const tiered = new TieredDurableStore({ hot, cold });

    const stuck = await tiered.listStuckExecutions!();

    expect(stuck.map((execution) => execution.id)).toEqual(["hot-stuck"]);
  });
});
