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
import { createMessageError } from "../../../errors";
import { Logger } from "../../../models/Logger";

class ThrowingQueue implements IDurableQueue {
  async enqueue<T>(
    _message: Omit<QueueMessage<T>, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    throw createMessageError("queue-down");
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
      id: "t.retry",
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
});
