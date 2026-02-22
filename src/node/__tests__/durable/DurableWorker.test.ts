import type {
  IDurableQueue,
  MessageHandler,
  QueueMessage,
} from "../../durable/core/interfaces/queue";
import type { IDurableExecutionProcessor } from "../../durable/core/interfaces/service";
import { DurableWorker } from "../../durable/core/DurableWorker";
import { createMessageError } from "../../../errors";
import { Logger } from "../../../models/Logger";

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
  function createSilentLogger(): Logger {
    return new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
  }

  it("acks successful execution messages", async () => {
    const queue = new TestQueue();
    const service: IDurableExecutionProcessor = {
      processExecution: jest.fn(async () => {}),
    };

    const worker = new DurableWorker(service, queue, createSilentLogger());
    await worker.start();

    await queue.handler?.(message({ executionId: "e1" }, "execute"));

    expect(service.processExecution).toHaveBeenCalledWith("e1");
    expect(queue.ackCalls).toEqual(["m1"]);
  });

  it("nacks on handler errors", async () => {
    const queue = new TestQueue();
    const service: IDurableExecutionProcessor = {
      processExecution: jest.fn(async () => {
        throw createMessageError("boom");
      }),
    };

    const worker = new DurableWorker(service, queue, createSilentLogger());
    await worker.start();

    await queue.handler?.(message({ executionId: "e1" }, "resume"));

    expect(queue.nackCalls).toEqual([{ id: "m1", requeue: true }]);
  });

  it("uses a fallback logger when logger is omitted", async () => {
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

  it("ignores unknown payload shapes", async () => {
    const queue = new TestQueue();
    const service: IDurableExecutionProcessor = {
      processExecution: jest.fn(async () => {}),
    };

    const worker = new DurableWorker(service, queue, createSilentLogger());
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

    const worker = new DurableWorker(service, queue, createSilentLogger());
    await worker.start();

    await queue.handler?.(message({ executionId: "e1" }, "schedule"));
    expect(service.processExecution).toHaveBeenCalledWith("e1");
    expect(queue.ackCalls).toEqual(["m1"]);
  });

  it("acks unsupported message types without processing executions", async () => {
    const queue = new TestQueue();
    const service: IDurableExecutionProcessor = {
      processExecution: jest.fn(async () => {}),
    };

    const worker = new DurableWorker(service, queue, createSilentLogger());
    await worker.start();

    const unknown = { ...message({ executionId: "e1" }, "execute"), type: "x" };
    await queue.handler?.(unknown as QueueMessage);

    expect(service.processExecution).not.toHaveBeenCalled();
    expect(queue.ackCalls).toEqual(["m1"]);
  });
});
