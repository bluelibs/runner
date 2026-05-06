import { AuditLogger } from "../../../../durable/core/managers/AuditLogger";
import { ExecutionManager } from "../../../../durable/core/managers/ExecutionManager";
import { RecoveryManager } from "../../../../durable/core/managers/RecoveryManager";
import { TaskRegistry } from "../../../../durable/core/managers/TaskRegistry";
import { WaitManager } from "../../../../durable/core/managers/WaitManager";
import {
  ExecutionStatus,
  TimerStatus,
  TimerType,
  type Execution,
} from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import type { ITask } from "../../../../../types/task";

enum TaskId {
  T = "durable-tests-recovery-cancelling-t",
}

describe("durable: RecoveryManager cancelling recovery", () => {
  const task: ITask<unknown, Promise<unknown>, any, any, any, any> = {
    id: TaskId.T,
  } as any;

  function createCancellingExecution(
    overrides: Partial<Execution> = {},
  ): Execution {
    const now = new Date();
    return {
      id: "e-cancelling-recovery",
      workflowKey: TaskId.T,
      input: undefined,
      status: ExecutionStatus.Cancelling,
      attempt: 1,
      maxAttempts: 1,
      cancelRequestedAt: now,
      error: { message: "cancel me" },
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function createExecutionManager(store: MemoryStore): ExecutionManager {
    const taskRegistry = new TaskRegistry();
    taskRegistry.register(task);

    return new ExecutionManager(
      { store },
      taskRegistry,
      new AuditLogger({ enabled: false }, store),
      new WaitManager(store),
    );
  }

  it("recovers stranded cancelling executions and finalizes them as cancelled", async () => {
    const store = new MemoryStore();
    const executionManager = createExecutionManager(store);
    const recoveryManager = new RecoveryManager(store, executionManager, {
      error: jest.fn(async () => {}),
    } as any);

    await store.saveExecution(createCancellingExecution());
    await store.createTimer({
      id: "t-stale-retry",
      executionId: "e-cancelling-recovery",
      type: TimerType.Retry,
      fireAt: new Date(Date.now() + 60_000),
      status: TimerStatus.Pending,
    });

    const report = await recoveryManager.recover();
    const recoveredExecution = await store.getExecution(
      "e-cancelling-recovery",
    );

    expect(report).toEqual({
      scannedCount: 1,
      recoveredCount: 1,
      skippedCount: 0,
      failedCount: 0,
      recovered: [
        {
          executionId: "e-cancelling-recovery",
          status: ExecutionStatus.Cancelling,
        },
      ],
      skipped: [],
      failures: [],
    });
    expect(recoveredExecution).toEqual(
      expect.objectContaining({
        id: "e-cancelling-recovery",
        status: ExecutionStatus.Cancelled,
        cancelRequestedAt: expect.any(Date),
        cancelledAt: expect.any(Date),
        completedAt: expect.any(Date),
        error: { message: "cancel me" },
      }),
    );
    await expect(
      new WaitManager(store).waitForResult("e-cancelling-recovery"),
    ).rejects.toThrow("cancel me");
    await expect(store.listIncompleteExecutions()).resolves.toEqual([]);
  });
});
