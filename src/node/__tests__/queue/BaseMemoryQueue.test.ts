import { BaseMemoryQueue } from "../../queue/BaseMemoryQueue";

type TestMessage = {
  id: string;
  createdAt: Date;
  attempts: number;
  payload: string;
};

class TestMemoryQueue extends BaseMemoryQueue<TestMessage> {
  async enqueue(payload: string): Promise<string> {
    return this.enqueueMessage({ payload });
  }

  async consume(
    handler: (message: TestMessage) => Promise<void>,
  ): Promise<void> {
    this.messageHandler = handler;
    this.scheduleProcessing();
  }

  async ack(messageId: string): Promise<void> {
    return this.ackMessage(messageId);
  }

  async nack(messageId: string, requeue: boolean = true): Promise<void> {
    return this.nackMessage(messageId, requeue);
  }
}

describe("queue: BaseMemoryQueue", () => {
  it("requeues uncaught handler failures by default", async () => {
    const queue = new TestMemoryQueue();
    const attempts: number[] = [];

    await queue.enqueue("x");
    await queue.consume(async (message) => {
      attempts.push(message.attempts);
      if (message.attempts === 1) {
        throw new Error("fail once");
      }
      await queue.ack(message.id);
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(attempts).toEqual([1, 2]);
  });
});
