import { DurableService } from "../../durable/core/DurableService";
import { SuspensionSignal } from "../../durable/core/interfaces/context";
import type { Execution } from "../../durable/core/types";
import { ExecutionStatus } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import {
  createTaskExecutor,
  okTask,
  pendingExecution,
} from "./DurableService.unit.helpers";

type TestExecutionManager = {
  assertStoreLockOwnership: (lockState: {
    lost: boolean;
    lossError: Error | null;
    triggerLoss: (error: Error) => void;
    waitForLoss: Promise<never>;
    lockId?: string | "no-lock";
    lockResource?: string;
    lockTtlMs?: number;
  }) => Promise<void>;
  runExecutionAttempt: (
    execution: Execution,
    taskDef: ReturnType<typeof okTask>,
    lockState: {
      lost: boolean;
      lossError: Error | null;
      triggerLoss: (error: Error) => void;
      waitForLoss: Promise<never>;
      lockId?: string | "no-lock";
      lockResource?: string;
      lockTtlMs?: number;
    },
  ) => Promise<void>;
};

function getManager(service: DurableService): TestExecutionManager {
  return service._executionManager as unknown as TestExecutionManager;
}

function createLockState(
  overrides?: Partial<
    Parameters<TestExecutionManager["assertStoreLockOwnership"]>[0]
  >,
) {
  return {
    lost: false,
    lossError: null,
    triggerLoss: jest.fn(),
    waitForLoss: new Promise<never>(() => {}),
    ...overrides,
  };
}

describe("durable: ExecutionManager persistence outcomes", () => {
  it("persists sleeping and retrying outcomes when ownership remains valid", async () => {
    const sleepStore = new MemoryStore();
    const sleepTask = okTask("t-sleep-path");
    const sleepService = new DurableService({
      store: sleepStore,
      taskExecutor: createTaskExecutor({
        [sleepTask.id]: async () => {
          throw new SuspensionSignal("sleep");
        },
      }),
      tasks: [sleepTask],
    });
    const sleepingExecution = pendingExecution({
      id: "e-sleep-path",
      workflowKey: sleepTask.id,
    });
    await sleepStore.saveExecution(sleepingExecution);
    await getManager(sleepService).runExecutionAttempt(
      sleepingExecution,
      sleepTask,
      createLockState(),
    );
    expect((await sleepStore.getExecution("e-sleep-path"))?.status).toBe(
      ExecutionStatus.Sleeping,
    );

    const retryStore = new MemoryStore();
    const retryTask = okTask("t-retry-path");
    const retryService = new DurableService({
      store: retryStore,
      taskExecutor: createTaskExecutor({
        [retryTask.id]: async () => {
          throw new Error("boom");
        },
      }),
      tasks: [retryTask],
      execution: { maxAttempts: 2 },
    });
    const retryExecution = pendingExecution({
      id: "e-retry-path",
      workflowKey: retryTask.id,
      maxAttempts: 2,
    });
    await retryStore.saveExecution(retryExecution);
    await getManager(retryService).runExecutionAttempt(
      retryExecution,
      retryTask,
      createLockState(),
    );

    expect((await retryStore.getExecution("e-retry-path"))?.status).toBe(
      ExecutionStatus.Retrying,
    );
    expect(
      await retryStore.getReadyTimers(new Date(Date.now() + 10_000)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          executionId: "e-retry-path",
          type: "retry",
        }),
      ]),
    );
  });

  it("quietly aborts suspension and retry writes when lock ownership is lost during recheck", async () => {
    const sleepStore = new MemoryStore();
    jest.spyOn(sleepStore, "renewLock").mockResolvedValue(false);
    const sleepTask = okTask("t-sleep-lock-loss");
    const sleepService = new DurableService({
      store: sleepStore,
      taskExecutor: createTaskExecutor({
        [sleepTask.id]: async () => {
          throw new SuspensionSignal("sleep");
        },
      }),
      tasks: [sleepTask],
    });
    const sleepingExecution = pendingExecution({
      id: "e-sleep-lock-loss",
      workflowKey: sleepTask.id,
    });
    await sleepStore.saveExecution(sleepingExecution);
    await getManager(sleepService).runExecutionAttempt(
      sleepingExecution,
      sleepTask,
      createLockState({
        lockId: "lock-sleep",
        lockResource: "execution:sleep-loss",
        lockTtlMs: 1_000,
      }),
    );
    expect((await sleepStore.getExecution("e-sleep-lock-loss"))?.status).toBe(
      ExecutionStatus.Running,
    );

    const retryStore = new MemoryStore();
    jest.spyOn(retryStore, "renewLock").mockResolvedValue(false);
    const retryTask = okTask("t-retry-lock-loss");
    const retryService = new DurableService({
      store: retryStore,
      taskExecutor: createTaskExecutor({
        [retryTask.id]: async () => {
          throw new Error("boom");
        },
      }),
      tasks: [retryTask],
      execution: { maxAttempts: 2 },
    });
    const retryExecution = pendingExecution({
      id: "e-retry-lock-loss",
      workflowKey: retryTask.id,
      maxAttempts: 2,
    });
    await retryStore.saveExecution(retryExecution);
    await getManager(retryService).runExecutionAttempt(
      retryExecution,
      retryTask,
      createLockState({
        lockId: "lock-retry",
        lockResource: "execution:retry-loss",
        lockTtlMs: 1_000,
      }),
    );
    expect((await retryStore.getExecution("e-retry-lock-loss"))?.status).toBe(
      ExecutionStatus.Running,
    );
    expect(
      await retryStore.getReadyTimers(new Date(Date.now() + 10_000)),
    ).toEqual([]);
  });

  it("rethrows unexpected ownership recheck failures", async () => {
    const store = new MemoryStore();
    const task = okTask("t-unexpected-recheck");
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({
        [task.id]: async () => {
          throw new Error("boom");
        },
      }),
      tasks: [task],
      execution: { maxAttempts: 2 },
    });
    const execution = pendingExecution({
      id: "e-unexpected-recheck",
      workflowKey: task.id,
      maxAttempts: 2,
    });
    await store.saveExecution(execution);

    const manager = getManager(service) as unknown as {
      runExecutionAttempt: TestExecutionManager["runExecutionAttempt"];
      assertStoreLockOwnership: () => Promise<void>;
    };
    jest
      .spyOn(manager, "assertStoreLockOwnership")
      .mockRejectedValue(new Error("unexpected-recheck"));

    await expect(
      manager.runExecutionAttempt(execution, task, createLockState()),
    ).rejects.toThrow("unexpected-recheck");
  });

  it("bails out when clearing stale current on an already-running execution loses the CAS race", async () => {
    const store = new MemoryStore();
    const task = okTask("t-running-cas-race");
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({ [task.id]: async () => "ok" }),
      tasks: [task],
      execution: { maxAttempts: 1 },
    });
    const execution = pendingExecution({
      id: "e-running-cas-race",
      workflowKey: task.id,
      status: ExecutionStatus.Running,
      current: {
        kind: "waitForSignal",
        stepId: "__signal:old",
        startedAt: new Date(),
        waitingFor: {
          type: "signal",
          params: {
            signalId: "old-signal",
          },
        },
      },
    });
    await store.saveExecution(execution);
    jest.spyOn(store, "saveExecutionIfStatus").mockResolvedValueOnce(false);

    await getManager(service).runExecutionAttempt(
      execution,
      task,
      createLockState(),
    );

    expect((await store.getExecution("e-running-cas-race"))?.current).toEqual(
      execution.current,
    );
  });
});
