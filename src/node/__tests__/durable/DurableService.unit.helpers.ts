import { r } from "../../..";
import type {
  IDurableQueue,
  QueueMessage,
  MessageHandler,
} from "../../durable/core/interfaces/queue";
import type { ITaskExecutor } from "../../durable/core/interfaces/service";
import type { IDurableStore } from "../../durable/core/interfaces/store";
import type { Execution } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { DurableService } from "../../durable/core/DurableService";
import { genericError } from "../../../errors";
import { Logger, type ILog } from "../../../models/Logger";

// ---------------------------------------------------------------------------
// Task executor
// ---------------------------------------------------------------------------

export function createTaskExecutor(
  handlers: Record<string, (input: unknown) => Promise<any>>,
): ITaskExecutor {
  return {
    run: async (task, input) => {
      const handler = handlers[task.id];
      if (!handler) {
        throw genericError.new({
          message: `No task handler registered for: ${task.id}`,
        });
      }
      return await handler(input);
    },
  };
}

// ---------------------------------------------------------------------------
// Spy queue — records enqueued messages for assertions
// ---------------------------------------------------------------------------

export class SpyQueue implements IDurableQueue {
  public enqueued: Array<Pick<QueueMessage, "type" | "payload">> = [];

  async enqueue<T>(
    message: Omit<QueueMessage<T>, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    this.enqueued.push({ type: message.type, payload: message.payload });
    return "id";
  }

  async consume<T>(_handler: MessageHandler<T>): Promise<void> {}
  async ack(_messageId: string): Promise<void> {}
  async nack(_messageId: string, _requeue?: boolean): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Async / timer helpers
// ---------------------------------------------------------------------------

export async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

export async function advanceTimers(ms: number): Promise<void> {
  const asyncAdvance = (
    jest as unknown as {
      advanceTimersByTimeAsync?: (msToRun: number) => Promise<void>;
    }
  ).advanceTimersByTimeAsync;

  if (asyncAdvance) {
    await asyncAdvance(ms);
    return;
  }

  jest.advanceTimersByTime(ms);
  await flushMicrotasks();
}

export function requireScheduledCallback(
  callback: (() => void) | null,
  message: string,
): () => void {
  if (!callback) {
    throw genericError.new({ message });
  }

  return callback;
}

export function captureScheduledTimeout() {
  let scheduledCallback: (() => void) | null = null;
  const clearTimeoutSpy = jest
    .spyOn(global, "clearTimeout")
    .mockImplementation(() => undefined);
  const mockSetTimeout = ((callback: TimerHandler) => {
    if (typeof callback === "function") {
      scheduledCallback = callback as () => void;
    }
    return { unref: jest.fn() } as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  const setTimeoutSpy = jest
    .spyOn(global, "setTimeout")
    .mockImplementation(mockSetTimeout);

  return {
    clearTimeoutSpy,
    getScheduledCallback(message: string) {
      return requireScheduledCallback(scheduledCallback, message);
    },
    restore() {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    },
  };
}

// ---------------------------------------------------------------------------
// Logger helpers
// ---------------------------------------------------------------------------

export function createBufferedLogger(): { logger: Logger; logs: ILog[] } {
  const logs: ILog[] = [];
  const logger = new Logger({
    printThreshold: null,
    printStrategy: "pretty",
    bufferLogs: false,
  });

  logger.onLog((log) => {
    logs.push(log);
  });

  return { logger, logs };
}

// ---------------------------------------------------------------------------
// Bare store — MemoryStore stripped of optional capabilities
// ---------------------------------------------------------------------------

/**
 * Creates a minimal IDurableStore by delegating to `base` (MemoryStore),
 * intentionally omitting optional methods like `acquireLock`, `releaseLock`,
 * `listStepResults`, and `appendAuditEntry`.
 *
 * Pass `overrides` to add back specific optional methods.
 */
export function createBareStore(
  base: MemoryStore,
  overrides?: Partial<IDurableStore>,
): IDurableStore {
  return {
    saveExecution: base.saveExecution.bind(base),
    getExecution: base.getExecution.bind(base),
    updateExecution: base.updateExecution.bind(base),
    listIncompleteExecutions: base.listIncompleteExecutions.bind(base),
    getStepResult: base.getStepResult.bind(base),
    saveStepResult: base.saveStepResult.bind(base),
    getSignalState: base.getSignalState.bind(base),
    appendSignalRecord: base.appendSignalRecord.bind(base),
    enqueueQueuedSignalRecord: base.enqueueQueuedSignalRecord.bind(base),
    consumeQueuedSignalRecord: base.consumeQueuedSignalRecord.bind(base),
    upsertSignalWaiter: base.upsertSignalWaiter.bind(base),
    takeNextSignalWaiter: base.takeNextSignalWaiter.bind(base),
    deleteSignalWaiter: base.deleteSignalWaiter.bind(base),
    createTimer: base.createTimer.bind(base),
    getReadyTimers: base.getReadyTimers.bind(base),
    markTimerFired: base.markTimerFired.bind(base),
    deleteTimer: base.deleteTimer.bind(base),
    createSchedule: base.createSchedule.bind(base),
    getSchedule: base.getSchedule.bind(base),
    updateSchedule: base.updateSchedule.bind(base),
    saveScheduleWithTimer: base.saveScheduleWithTimer.bind(base),
    deleteSchedule: base.deleteSchedule.bind(base),
    listSchedules: base.listSchedules.bind(base),
    listActiveSchedules: base.listActiveSchedules.bind(base),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Factory: simple "ok" task
// ---------------------------------------------------------------------------

export function okTask(id: string) {
  return r
    .task(id)
    .run(async () => "ok")
    .build();
}

// ---------------------------------------------------------------------------
// Factory: execution records
// ---------------------------------------------------------------------------

export function pendingExecution(
  overrides: Partial<Execution> & { taskId: string },
): Execution {
  return {
    id: "e1",
    input: undefined,
    status: "pending",
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function sleepingExecution(overrides?: Partial<Execution>): Execution {
  return pendingExecution({
    taskId: "t",
    status: "sleeping",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Factory: DurableService with an executor that mirrors registered tasks
// ---------------------------------------------------------------------------

export function createServiceWithTasks(
  store: IDurableStore,
  tasks: ReturnType<typeof okTask>[],
  extra?: Partial<ConstructorParameters<typeof DurableService>[0]>,
) {
  const handlers: Record<string, (input: unknown) => Promise<any>> = {};
  for (const t of tasks) {
    handlers[t.id] = async (input) => (t as any).run(input);
  }

  return new DurableService({
    store,
    taskExecutor: createTaskExecutor(handlers),
    tasks,
    execution: { maxAttempts: 1 },
    ...extra,
  });
}
