import { Logger } from "../../../models/Logger";
import { AuditLogger } from "../../durable/core/managers/AuditLogger";
import {
  handleExecutionWaitTimeoutTimer,
  handleSignalTimeoutTimer,
  handleSleepTimer,
} from "../../durable/core/managers/PollingManager.timerHandlers";
import { TimerType } from "../../durable/core/types";
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
