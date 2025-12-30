import type {
  IDurableQueue,
  MessageHandler,
  QueueMessage,
} from "../core/interfaces/queue";
import type { IDurableExecutionProcessor } from "../core/interfaces/service";
import { DurableWorker } from "../core/DurableWorker";

class TestQueue implements IDurableQueue {
  public handler: MessageHandler<unknown> | null = null;
  public ackCalls: string[] = [];
  public nackCalls: Array<{ id: string; requeue?: boolean }> = [];

  async enqueue<T>(
    _message: Omit<QueueMessage<T>, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    return "id";
  }

  async consume<T>(handler: MessageHandler<T>): Promise<void> {
    this.handler = async (message) => handler(message as QueueMessage<T>);
  }

  async ack(messageId: string): Promise<void> {
    this.ackCalls.push(messageId);
  }

  async nack(messageId: string, requeue?: boolean): Promise<void> {
    this.nackCalls.push({ id: messageId, requeue });
  }
}

function message(payload: unknown, type: QueueMessage["type"]): QueueMessage {
  return {
    id: "m1",
    type,
    payload,
    attempts: 0,
    maxAttempts: 1,
    createdAt: new Date(),
  };
}

describe("durable: DurableWorker", () => {
  it("acks successful execution messages", async () => {
    const queue = new TestQueue();
    const service: IDurableExecutionProcessor = {
      processExecution: jest.fn(async () => {}),
    };

    const worker = new DurableWorker(service, queue);
    await worker.start();

    await queue.handler?.(message({ executionId: "e1" }, "execute"));

    expect(service.processExecution).toHaveBeenCalledWith("e1");
    expect(queue.ackCalls).toEqual(["m1"]);
  });

  it("nacks on handler errors", async () => {
    const queue = new TestQueue();
    const service: IDurableExecutionProcessor = {
      processExecution: jest.fn(async () => {
        throw new Error("boom");
      }),
    };

    const worker = new DurableWorker(service, queue);
    await worker.start();

    await queue.handler?.(message({ executionId: "e1" }, "resume"));

    expect(queue.nackCalls).toEqual([{ id: "m1", requeue: true }]);
  });

  it("ignores unknown payload shapes", async () => {
    const queue = new TestQueue();
    const service: IDurableExecutionProcessor = {
      processExecution: jest.fn(async () => {}),
    };

    const worker = new DurableWorker(service, queue);
    await worker.start();

    await queue.handler?.(message("bad", "execute"));
    await queue.handler?.(message({ executionId: 123 }, "execute"));
    expect(service.processExecution).not.toHaveBeenCalled();
    expect(queue.ackCalls).toEqual(["m1", "m1"]);
  });

  it("ignores non-execution message types", async () => {
    const queue = new TestQueue();
    const service: IDurableExecutionProcessor = {
      processExecution: jest.fn(async () => {}),
    };

    const worker = new DurableWorker(service, queue);
    await worker.start();

    await queue.handler?.(message({ executionId: "e1" }, "schedule"));
    expect(service.processExecution).not.toHaveBeenCalled();
    expect(queue.ackCalls).toEqual(["m1"]);
  });
});
