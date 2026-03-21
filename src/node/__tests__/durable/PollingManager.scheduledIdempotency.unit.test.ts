import type {
  IDurableQueue,
  QueueMessage,
} from "../../durable/core/interfaces/queue";
import type { MessageHandler } from "../../durable/core/interfaces/queue";
import { DurableService } from "../../durable/core/DurableService";
import { TimerStatus, TimerType, type Timer } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import {
  advanceTimers,
  createTaskExecutor,
  okTask,
} from "./DurableService.unit.helpers";

class RecordingDelayedQueue implements IDurableQueue {
  public enqueued: Array<Pick<QueueMessage, "type" | "payload">> = [];

  async enqueue<T>(
    message: Omit<QueueMessage<T>, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    this.enqueued.push({ type: message.type, payload: message.payload });

    return await new Promise<string>((resolve) => {
      setTimeout(() => resolve("queued"), 1_200);
    });
  }

  async consume<T>(_handler: MessageHandler<T>): Promise<void> {}
  async ack(_messageId: string): Promise<void> {}
  async nack(_messageId: string, _requeue?: boolean): Promise<void> {}
}

describe("durable: PollingManager scheduled timer idempotency", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("reuses the same execution when a claimed scheduled timer is retried", async () => {
    const store = new MemoryStore();
    const queue = new RecordingDelayedQueue();
    const task = okTask("t-scheduled-claim-loss");
    const service = new DurableService({
      store,
      queue,
      tasks: [task],
      taskExecutor: createTaskExecutor({}),
      polling: { claimTtlMs: 3_000 },
    });

    jest.spyOn(store, "renewTimerClaim").mockResolvedValue(false);

    const timer: Timer = {
      id: "sched:claim-loss",
      taskId: task.id,
      type: TimerType.Scheduled,
      fireAt: new Date(0),
      status: TimerStatus.Pending,
    };
    await store.createTimer(timer);

    const firstAttempt = service.handleTimer(timer);
    await advanceTimers(1_100);
    await advanceTimers(200);
    await firstAttempt;

    await advanceTimers(2_000);

    const secondAttempt = service.handleTimer(timer);
    await advanceTimers(1_100);
    await advanceTimers(200);
    await secondAttempt;

    const executions = await store.listIncompleteExecutions();
    const executionIds = queue.enqueued
      .filter((message) => message.type === "execute")
      .map(
        (message) =>
          (message.payload as { executionId: string | undefined }).executionId,
      );

    expect(executions).toHaveLength(1);
    expect(new Set(executionIds)).toEqual(new Set([executions[0]!.id]));
  });
});
