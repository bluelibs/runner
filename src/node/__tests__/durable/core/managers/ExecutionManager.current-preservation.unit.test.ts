import {
  scheduleExecutionRetry,
  suspendExecutionAttempt,
  transitionExecutionToFailed,
} from "../../../../durable/core/managers/ExecutionManager.transitions";
import { createStepCurrent } from "../../../../durable/core/current";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";

function runningExecution(id: string): Execution {
  return {
    id,
    workflowKey: "app.tasks.workflow",
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 3,
    createdAt: new Date("2026-09-14T12:00:00.000Z"),
    updatedAt: new Date("2026-09-14T12:00:00.000Z"),
  };
}

const logStatusChange = async (): Promise<void> => undefined;
const notifyFinished = async (): Promise<void> => undefined;
const finalizeCancellation = async (): Promise<boolean> => false;

async function saveLatestCurrent(
  store: MemoryStore,
  staleExecution: Execution,
  stepId: string,
): Promise<void> {
  await store.saveExecution({
    ...staleExecution,
    current: createStepCurrent({
      stepId,
      startedAt: new Date("2026-09-14T12:00:01.000Z"),
    }),
  });
}

describe("durable: attempt position preservation", () => {
  it("keeps the latest current position when an attempt suspends", async () => {
    const store = new MemoryStore();
    const staleExecution = runningExecution("suspend-current");
    await saveLatestCurrent(store, staleExecution, "await-approval");

    await suspendExecutionAttempt({
      store,
      execution: staleExecution,
      reason: "wait_for_signal",
      logStatusChange,
      finalizeCancellation,
    });

    expect(await store.getExecution(staleExecution.id)).toMatchObject({
      status: ExecutionStatus.Sleeping,
      current: { kind: "step", stepId: "await-approval" },
    });
  });

  it("keeps the failed position and records its step id beside the error", async () => {
    const store = new MemoryStore();
    const staleExecution = runningExecution("failed-current");
    await saveLatestCurrent(store, staleExecution, "charge-customer");

    await transitionExecutionToFailed({
      store,
      execution: staleExecution,
      from: ExecutionStatus.Running,
      reason: "failed",
      error: { message: "Card processor exploded" },
      logStatusChange,
      notifyFinished,
      finalizeCancellation,
    });

    expect(await store.getExecution(staleExecution.id)).toMatchObject({
      status: ExecutionStatus.Failed,
      current: { kind: "step", stepId: "charge-customer" },
      error: {
        message: "Card processor exploded",
        stepId: "charge-customer",
      },
    });
  });

  it("keeps the failed position while waiting to retry", async () => {
    const store = new MemoryStore();
    const staleExecution = runningExecution("retry-current");
    await saveLatestCurrent(store, staleExecution, "call-provider");

    await scheduleExecutionRetry({
      store,
      runningExecution: staleExecution,
      error: { message: "Provider unavailable" },
      logStatusChange,
      finalizeCancellation,
    });

    expect(await store.getExecution(staleExecution.id)).toMatchObject({
      status: ExecutionStatus.Retrying,
      current: { kind: "step", stepId: "call-provider" },
      error: { message: "Provider unavailable", stepId: "call-provider" },
    });
  });

  it("does not let a stale failure replace a newer attempt", async () => {
    const store = new MemoryStore();
    const staleExecution = runningExecution("stale-failure");
    const newerExecution = {
      ...staleExecution,
      attempt: 2,
      current: createStepCurrent({
        stepId: "new-attempt-step",
        startedAt: new Date("2026-09-14T12:00:02.000Z"),
      }),
    };
    await store.saveExecution(newerExecution);
    const finalize = jest.fn(async () => false);

    await transitionExecutionToFailed({
      store,
      execution: staleExecution,
      from: ExecutionStatus.Running,
      reason: "failed",
      error: { message: "stale error" },
      logStatusChange,
      notifyFinished,
      finalizeCancellation: finalize,
    });

    expect(await store.getExecution(staleExecution.id)).toMatchObject({
      status: ExecutionStatus.Running,
      attempt: 2,
      current: { stepId: "new-attempt-step" },
    });
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it("does not let a stale suspension replace a newer attempt", async () => {
    const store = new MemoryStore();
    const staleExecution = runningExecution("stale-suspend");
    await store.saveExecution({ ...staleExecution, attempt: 2 });
    const finalize = jest.fn(async () => false);

    await suspendExecutionAttempt({
      store,
      execution: staleExecution,
      reason: "sleep",
      logStatusChange,
      finalizeCancellation: finalize,
    });

    expect(await store.getExecution(staleExecution.id)).toMatchObject({
      status: ExecutionStatus.Running,
      attempt: 2,
    });
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it("does not create a retry timer for a stale attempt", async () => {
    const store = new MemoryStore();
    const staleExecution = runningExecution("stale-retry");
    await store.saveExecution({ ...staleExecution, attempt: 2 });
    const finalize = jest.fn(async () => false);

    await scheduleExecutionRetry({
      store,
      runningExecution: staleExecution,
      error: { message: "stale error" },
      logStatusChange,
      finalizeCancellation: finalize,
    });

    expect(await store.getReadyTimers(new Date("2100-01-01"))).toEqual([]);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale non-running failure without finalizing cancellation", async () => {
    const store = new MemoryStore();
    const staleExecution = {
      ...runningExecution("stale-pending-failure"),
      status: ExecutionStatus.Pending,
    };
    await store.saveExecution({
      ...staleExecution,
      status: ExecutionStatus.Running,
    });
    const finalize = jest.fn(async () => false);

    await transitionExecutionToFailed({
      store,
      execution: staleExecution,
      from: ExecutionStatus.Pending,
      reason: "task_not_registered",
      error: { message: "stale error" },
      logStatusChange,
      notifyFinished,
      finalizeCancellation: finalize,
    });

    expect((await store.getExecution(staleExecution.id))?.status).toBe(
      ExecutionStatus.Running,
    );
    expect(finalize).not.toHaveBeenCalled();
  });
});
