import type {
  IDurableQueue,
  QueueMessage,
} from "../../durable/core/interfaces/queue";
import type { MessageHandler } from "../../durable/core/interfaces/queue";
import { DurableService } from "../../durable/core/DurableService";
import type { Timer } from "../../durable/core/types";
import { TimerStatus, TimerType } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";

class ThrowingQueue implements IDurableQueue {
  async enqueue<T>(
    _message: Omit<QueueMessage<T>, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    throw new Error("queue-down");
  }

  async consume<T>(_handler: MessageHandler<T>): Promise<void> {}
  async ack(_messageId: string): Promise<void> {}
  async nack(_messageId: string, _requeue?: boolean): Promise<void> {}
}

function futureTimers(store: MemoryStore): Promise<Timer[]> {
  return store.getReadyTimers(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
}

describe("durable: PollingManager timer failure handling (unit)", () => {
  it("does not drop execution timers when resume enqueue fails", async () => {
    const store = new MemoryStore();
    const queue = new ThrowingQueue();
    const service = new DurableService({ store, queue, tasks: [] });

    const timer: Timer = {
      id: "t.retry",
      executionId: "e1",
      type: TimerType.Retry,
      fireAt: new Date(0),
      status: TimerStatus.Pending,
    };
    await store.createTimer(timer);

    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      await service.handleTimer(timer);
    } finally {
      consoleSpy.mockRestore();
    }

    const timers = await futureTimers(store);
    expect(timers).toEqual([expect.objectContaining({ id: timer.id })]);
  });
});
