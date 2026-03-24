import type {
  IDurableQueue,
  QueueMessage,
} from "../../durable/core/interfaces/queue";
import type { MessageHandler } from "../../durable/core/interfaces/queue";
import { DurableService } from "../../durable/core/DurableService";
import type { Timer } from "../../durable/core/types";
import { TimerStatus, TimerType } from "../../durable/core/types";
import {
  AuditLogger,
  PollingManager,
  ScheduleManager,
  TaskRegistry,
} from "../../durable/core/managers";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { genericError } from "../../../errors";
import { Logger, type ILog } from "../../../models/Logger";
import { okTask, sleepingExecution } from "./DurableService.unit.helpers";

class ThrowingQueue implements IDurableQueue {
  async enqueue<T>(
    _message: Omit<QueueMessage<T>, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    throw genericError.new({ message: "queue-down" });
  }

  async consume<T>(_handler: MessageHandler<T>): Promise<void> {}
  async ack(_messageId: string): Promise<void> {}
  async nack(_messageId: string, _requeue?: boolean): Promise<void> {}
}

function futureTimers(store: MemoryStore): Promise<Timer[]> {
  return store.getReadyTimers(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
}

describe("durable: PollingManager timer failure handling (unit)", () => {
  it("supports PollingManager construction without an explicit logger", async () => {
    const store = new MemoryStore();
    const taskRegistry = new TaskRegistry();
    const auditLogger = new AuditLogger({}, store);
    const scheduleManager = new ScheduleManager(store, taskRegistry);
    const callbacks = {
      processExecution: jest.fn(async () => {}),
      kickoffExecution: jest.fn(async () => {}),
    };

    const pollingManager = new PollingManager(
      "worker-1",
      { interval: 1 },
      store,
      undefined,
      3,
      undefined,
      taskRegistry,
      auditLogger,
      scheduleManager,
      callbacks,
    );

    await pollingManager.stop();
    expect(pollingManager).toBeInstanceOf(PollingManager);
  });

  it("does not drop execution timers when resume enqueue fails", async () => {
    const store = new MemoryStore();
    const queue = new ThrowingQueue();
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    const service = new DurableService({ store, queue, tasks: [], logger });

    const timer: Timer = {
      id: "t-retry",
      executionId: "e1",
      type: TimerType.Retry,
      fireAt: new Date(0),
      status: TimerStatus.Pending,
    };
    await store.createTimer(timer);

    await service.handleTimer(timer);

    const timers = await futureTimers(store);
    expect(timers).toEqual([expect.objectContaining({ id: timer.id })]);
  });

  it("keeps signal-timeout timers pending when the step id cannot resolve a signal id", async () => {
    const store = new MemoryStore();
    const logs: ILog[] = [];
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    logger.onLog((log) => {
      logs.push(log);
    });
    const service = new DurableService({ store, tasks: [], logger });

    await store.saveExecution(sleepingExecution());
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    const timer: Timer = {
      id: "t-invalid-signal-timeout",
      executionId: "e1",
      stepId: "__signal:",
      type: TimerType.SignalTimeout,
      fireAt: new Date(0),
      status: TimerStatus.Pending,
    };
    await store.createTimer(timer);

    await service.handleTimer(timer);

    expect(
      (await futureTimers(store)).some(
        (readyTimer) => readyTimer.id === timer.id,
      ),
    ).toBe(true);
    expect((await store.getStepResult("e1", "__signal:"))?.result).toEqual({
      state: "waiting",
    });
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          message: "Durable timer handling failed.",
        }),
      ]),
    );
  });

  it("replaces the original scheduled timer with a kickoff failsafe after execution creation", async () => {
    const store = new MemoryStore();
    const queue = new ThrowingQueue();
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    const task = okTask("t-scheduled-queue-down");
    const service = new DurableService({
      store,
      queue,
      tasks: [task],
      logger,
    });

    const timer: Timer = {
      id: "t-scheduled-queue-down",
      workflowKey: task.id,
      type: TimerType.Scheduled,
      fireAt: new Date(0),
      status: TimerStatus.Pending,
    };
    await store.createTimer(timer);

    await service.handleTimer(timer);

    const [execution] = await store.listIncompleteExecutions();
    expect(execution).toBeDefined();
    expect(
      (await futureTimers(store)).some(
        (readyTimer) => readyTimer.id === timer.id,
      ),
    ).toBe(false);
    expect(await futureTimers(store)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `kickoff:${execution!.id}`,
          executionId: execution!.id,
        }),
      ]),
    );
  });

  it("logs cleanup failures after irreversible timer work has already happened", async () => {
    class CleanupFailureStore extends MemoryStore {
      override async deleteTimer(timerId: string): Promise<void> {
        if (timerId === "t-cleanup-failure") {
          throw genericError.new({ message: "delete-timer-failed" });
        }

        await super.deleteTimer(timerId);
      }
    }

    const store = new CleanupFailureStore();
    Object.defineProperty(store, "finalizeClaimedTimer", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const logs: ILog[] = [];
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    logger.onLog((log) => {
      logs.push(log);
    });
    const taskRegistry = new TaskRegistry();
    const auditLogger = new AuditLogger({ enabled: false }, store);
    const scheduleManager = new ScheduleManager(store, taskRegistry);
    const pollingManager = new PollingManager(
      "worker-1",
      { interval: 1 },
      store,
      undefined,
      3,
      undefined,
      taskRegistry,
      auditLogger,
      scheduleManager,
      {
        processExecution: jest.fn(async () => {
          throw genericError.new({ message: "resume-failed" });
        }),
        kickoffExecution: jest.fn(async () => {}),
      },
      logger,
    );

    await store.createTimer({
      id: "t-cleanup-failure",
      executionId: "e1",
      stepId: "sleep:1",
      type: TimerType.Sleep,
      fireAt: new Date(0),
      status: TimerStatus.Pending,
    });

    await pollingManager.handleTimer({
      id: "t-cleanup-failure",
      executionId: "e1",
      stepId: "sleep:1",
      type: TimerType.Sleep,
      fireAt: new Date(0),
      status: TimerStatus.Pending,
    });

    expect(
      logs.some(
        (log) =>
          log.level === "error" &&
          log.message === "Durable timer handling failed." &&
          (log.data as { cleanupError?: unknown } | undefined)
            ?.cleanupError instanceof Error,
      ),
    ).toBe(true);
  });

  it("logs claim-loss errors when atomic timer finalization can no longer verify ownership", async () => {
    class ClaimLossStore extends MemoryStore {
      override async finalizeClaimedTimer(): Promise<boolean> {
        return false;
      }
    }

    const store = new ClaimLossStore();
    const logs: ILog[] = [];
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    logger.onLog((log) => {
      logs.push(log);
    });
    const taskRegistry = new TaskRegistry();
    const auditLogger = new AuditLogger({ enabled: false }, store);
    const scheduleManager = new ScheduleManager(store, taskRegistry);
    const pollingManager = new PollingManager(
      "worker-1",
      { interval: 1 },
      store,
      undefined,
      3,
      undefined,
      taskRegistry,
      auditLogger,
      scheduleManager,
      {
        processExecution: jest.fn(async () => {}),
        kickoffExecution: jest.fn(async () => {}),
      },
      logger,
    );

    await store.createTimer({
      id: "t-claim-loss-before-finalize",
      executionId: "e1",
      type: TimerType.Retry,
      fireAt: new Date(0),
      status: TimerStatus.Pending,
    });

    await pollingManager.handleTimer({
      id: "t-claim-loss-before-finalize",
      executionId: "e1",
      type: TimerType.Retry,
      fireAt: new Date(0),
      status: TimerStatus.Pending,
    });

    expect(
      logs.some(
        (log) =>
          log.level === "error" &&
          log.message === "Durable timer handling failed." &&
          String(
            (log.error as { message?: string } | undefined)?.message,
          ).includes("before finalization could be committed"),
      ),
    ).toBe(true);
  });

  it("finalizes stale sleep timers without waking the execution", async () => {
    const store = new MemoryStore();
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    const taskRegistry = new TaskRegistry();
    const auditLogger = new AuditLogger({ enabled: false }, store);
    const scheduleManager = new ScheduleManager(store, taskRegistry);
    const processExecution = jest.fn(async () => {});
    const pollingManager = new PollingManager(
      "worker-1",
      { interval: 1 },
      store,
      undefined,
      3,
      undefined,
      taskRegistry,
      auditLogger,
      scheduleManager,
      {
        processExecution,
        kickoffExecution: jest.fn(async () => {}),
      },
      logger,
    );

    await store.saveExecution(
      sleepingExecution({
        id: "e-stale-sleep",
        current: {
          kind: "sleep",
          stepId: "__sleep:nap",
          startedAt: new Date(),
          waitingFor: {
            type: "sleep",
            params: {
              fireAtMs: Date.now() + 1_000,
              timerId: "sleep:e-stale-sleep:__sleep:nap:new",
            },
          },
        },
      }),
    );
    await store.saveStepResult({
      executionId: "e-stale-sleep",
      stepId: "__sleep:nap",
      result: {
        state: "sleeping",
        timerId: "sleep:e-stale-sleep:__sleep:nap:new",
        fireAtMs: Date.now() + 1_000,
      },
      completedAt: new Date(),
    });
    await store.createTimer({
      id: "sleep:e-stale-sleep:__sleep:nap:old",
      executionId: "e-stale-sleep",
      stepId: "__sleep:nap",
      type: TimerType.Sleep,
      fireAt: new Date(0),
      status: TimerStatus.Pending,
    });

    await pollingManager.handleTimer({
      id: "sleep:e-stale-sleep:__sleep:nap:old",
      executionId: "e-stale-sleep",
      stepId: "__sleep:nap",
      type: TimerType.Sleep,
      fireAt: new Date(0),
      status: TimerStatus.Pending,
    });

    expect(processExecution).not.toHaveBeenCalled();
    expect(
      await store.getStepResult("e-stale-sleep", "__sleep:nap"),
    ).toMatchObject({
      result: {
        state: "sleeping",
        timerId: "sleep:e-stale-sleep:__sleep:nap:new",
      },
    });
    expect((await store.getExecution("e-stale-sleep"))?.current).toMatchObject({
      kind: "sleep",
      stepId: "__sleep:nap",
    });
    expect(
      (await futureTimers(store)).some(
        (timer) => timer.id === "sleep:e-stale-sleep:__sleep:nap:old",
      ),
    ).toBe(false);
  });
});
