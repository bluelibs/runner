import { Logger } from "../../../models/Logger";
import { AuditLogger } from "../../durable/core/managers/AuditLogger";
import {
  handleExecutionWaitTimeoutTimer,
  handleSignalTimeoutTimer,
  handleSleepTimer,
} from "../../durable/core/managers/PollingManager.timerHandlers";
import { ExecutionStatus, TimerType } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";

describe("durable: PollingManager timer handlers (unit)", () => {
  it("ignores non-sleep or incomplete sleep timers", async () => {
    const store = new MemoryStore();
    const auditLogger = new AuditLogger({}, store);

    await expect(
      handleSleepTimer({
        store,
        auditLogger,
        timer: {
          id: "retry:1",
          type: TimerType.Retry,
          fireAt: new Date(),
          status: "pending",
        },
      }),
    ).resolves.toBeUndefined();

    await expect(
      handleSleepTimer({
        store,
        auditLogger,
        timer: {
          id: "sleep:missing-execution",
          type: TimerType.Sleep,
          stepId: "sleep:1",
          fireAt: new Date(),
          status: "pending",
        },
      }),
    ).resolves.toBeUndefined();
  });

  it("clears matching suspended current when a sleep timer completes", async () => {
    const store = new MemoryStore();
    const auditLogger = new AuditLogger({}, store);
    await store.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: ExecutionStatus.Sleeping,
      current: {
        kind: "sleep",
        stepId: "__sleep:nap",
        startedAt: new Date(),
        waitingFor: {
          type: "sleep",
          params: {
            fireAtMs: Date.now() + 1000,
            timerId: "sleep:e1:__sleep:nap",
          },
        },
      },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await handleSleepTimer({
      store,
      auditLogger,
      timer: {
        id: "sleep:e1:__sleep:nap",
        type: TimerType.Sleep,
        executionId: "e1",
        stepId: "__sleep:nap",
        fireAt: new Date(),
        status: "pending",
      },
    });

    expect((await store.getExecution("e1"))?.current).toBeUndefined();
  });

  it("ignores non-timeout or incomplete signal-timeout timers", async () => {
    const store = new MemoryStore();
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });

    await expect(
      handleSignalTimeoutTimer({
        store,
        logger,
        timer: {
          id: "sleep:1",
          type: TimerType.Sleep,
          executionId: "e1",
          stepId: "__signal:paid",
          fireAt: new Date(),
          status: "pending",
        },
      }),
    ).resolves.toBeNull();

    await expect(
      handleSignalTimeoutTimer({
        store,
        logger,
        timer: {
          id: "signal-timeout:missing-step",
          type: TimerType.SignalTimeout,
          executionId: "e1",
          fireAt: new Date(),
          status: "pending",
        },
      }),
    ).resolves.toBeNull();
  });

  it("clears matching suspended current when signal and execution waits time out", async () => {
    const store = new MemoryStore();
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });

    await store.saveExecution({
      id: "signal-exec",
      taskId: "t",
      input: undefined,
      status: ExecutionStatus.Sleeping,
      current: {
        kind: "waitForSignal",
        stepId: "__signal:paid",
        startedAt: new Date(),
        waitingFor: {
          type: "signal",
          params: {
            signalId: "paid",
            timerId: "signal_timeout:signal-exec:__signal:paid",
          },
        },
      },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "signal-exec",
      stepId: "__signal:paid",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await handleSignalTimeoutTimer({
      store,
      logger,
      timer: {
        id: "signal_timeout:signal-exec:__signal:paid",
        type: TimerType.SignalTimeout,
        executionId: "signal-exec",
        stepId: "__signal:paid",
        fireAt: new Date(),
        status: "pending",
      },
    });

    expect((await store.getExecution("signal-exec"))?.current).toBeUndefined();

    await store.saveExecution({
      id: "wait-exec",
      taskId: "t",
      input: undefined,
      status: ExecutionStatus.Sleeping,
      current: {
        kind: "waitForExecution",
        stepId: "__execution:child",
        startedAt: new Date(),
        waitingFor: {
          type: "execution",
          params: {
            targetExecutionId: "child",
            targetTaskId: "canonical.child",
            timerId: "execution_timeout:wait-exec:__execution:child",
          },
        },
      },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "wait-exec",
      stepId: "__execution:child",
      result: { state: "waiting", targetExecutionId: "child" },
      completedAt: new Date(),
    });
    await store.upsertExecutionWaiter({
      executionId: "wait-exec",
      targetExecutionId: "child",
      stepId: "__execution:child",
    });

    await handleExecutionWaitTimeoutTimer({
      store,
      timer: {
        id: "execution_timeout:wait-exec:__execution:child",
        type: TimerType.Timeout,
        executionId: "wait-exec",
        stepId: "__execution:child",
        fireAt: new Date(),
        status: "pending",
      },
    });

    expect((await store.getExecution("wait-exec"))?.current).toBeUndefined();
  });

  it("handles execution wait timeout timers across edge cases", async () => {
    const store = new MemoryStore();

    await expect(
      handleExecutionWaitTimeoutTimer({
        store,
        timer: {
          id: "sleep:1",
          type: TimerType.Sleep,
          executionId: "e1",
          stepId: "__execution:child",
          fireAt: new Date(),
          status: "pending",
        },
      }),
    ).resolves.toBe(false);

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__execution:child",
      result: { state: "completed", targetExecutionId: "child", result: 1 },
      completedAt: new Date(),
    });
    await expect(
      handleExecutionWaitTimeoutTimer({
        store,
        timer: {
          id: "timeout:1",
          type: TimerType.Timeout,
          executionId: "e1",
          stepId: "__execution:child",
          fireAt: new Date(),
          status: "pending",
        },
      }),
    ).resolves.toBe(false);

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__execution:child",
      result: { state: "waiting", targetExecutionId: "child" },
      completedAt: new Date(),
    });
    await expect(
      handleExecutionWaitTimeoutTimer({
        store,
        timer: {
          id: "timeout:2",
          type: TimerType.Timeout,
          executionId: "e1",
          stepId: "__execution:child",
          fireAt: new Date(),
          status: "pending",
        },
      }),
    ).resolves.toBe(true);

    const staleStore = new MemoryStore();
    const getStepResult = jest
      .fn()
      .mockResolvedValueOnce({
        executionId: "e1",
        stepId: "__execution:child",
        result: { state: "waiting", targetExecutionId: "child" },
        completedAt: new Date(),
      })
      .mockResolvedValueOnce({
        executionId: "e1",
        stepId: "__execution:child",
        result: { state: "completed", targetExecutionId: "child", result: 1 },
        completedAt: new Date(),
      });
    staleStore.getStepResult = getStepResult as MemoryStore["getStepResult"];

    await expect(
      handleExecutionWaitTimeoutTimer({
        store: staleStore,
        timer: {
          id: "timeout:stale",
          type: TimerType.Timeout,
          executionId: "e1",
          stepId: "__execution:child",
          fireAt: new Date(),
          status: "pending",
        },
      }),
    ).resolves.toBe(false);

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__execution:child",
      result: { state: "waiting", targetExecutionId: "child" },
      completedAt: new Date(),
    });
    await store.upsertExecutionWaiter({
      executionId: "e1",
      targetExecutionId: "child",
      stepId: "__execution:child",
    });

    await expect(
      handleExecutionWaitTimeoutTimer({
        store,
        timer: {
          id: "timeout:3",
          type: TimerType.Timeout,
          executionId: "e1",
          stepId: "__execution:child",
          fireAt: new Date(),
          status: "pending",
        },
      }),
    ).resolves.toBe(true);

    expect(
      (await store.getStepResult("e1", "__execution:child"))?.result,
    ).toEqual({
      state: "timed_out",
      targetExecutionId: "child",
    });
  });
});
