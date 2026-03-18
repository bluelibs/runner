import type {
  IDurableQueue,
  MessageHandler,
  QueueMessage,
} from "../../durable/core/interfaces/queue";
import type { IDurableExecutionProcessor } from "../../durable/core/interfaces/service";
import { DurableWorker } from "../../durable/core/DurableWorker";
import { genericError } from "../../../errors";
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

  function createService(params?: {
    processExecution?: (executionId: string) => Promise<void>;
    failExecutionDeliveryExhausted?: (
      executionId: string,
      details: {
        messageId: string;
        attempts: number;
        maxAttempts: number;
        errorMessage: string;
      },
    ) => Promise<void>;
  }): {
    service: IDurableExecutionProcessor;
    processExecution: jest.MockedFunction<
      (executionId: string) => Promise<void>
    >;
    failExecutionDeliveryExhausted: jest.MockedFunction<
      (
        executionId: string,
        details: {
          messageId: string;
          attempts: number;
          maxAttempts: number;
          errorMessage: string;
        },
      ) => Promise<void>
    >;
  } {
    const processExecution = jest.fn(
      params?.processExecution ?? (async () => {}),
    );
    const failExecutionDeliveryExhausted = jest.fn(
      params?.failExecutionDeliveryExhausted ?? (async () => {}),
    );

    return {
      service: {
        processExecution,
        failExecutionDeliveryExhausted,
      },
      processExecution,
      failExecutionDeliveryExhausted,
    };
  }

  it("acks successful execution messages", async () => {
    const queue = new TestQueue();
    const { service, processExecution } = createService();

    const worker = new DurableWorker(service, queue, createSilentLogger());
    await worker.start();

    await queue.handler?.(message({ executionId: "e1" }, "execute"));

    expect(processExecution).toHaveBeenCalledWith("e1");
    expect(queue.ackCalls).toEqual(["m1"]);
  });

  it("nacks on handler errors", async () => {
    const queue = new TestQueue();
    const { service, failExecutionDeliveryExhausted } = createService({
      processExecution: async () => {
        throw genericError.new({ message: "boom" });
      },
    });

    const worker = new DurableWorker(service, queue, createSilentLogger());
    await worker.start();

    await queue.handler?.(message({ executionId: "e1" }, "resume"));

    expect(queue.nackCalls).toEqual([{ id: "m1", requeue: true }]);
    expect(failExecutionDeliveryExhausted).not.toHaveBeenCalled();
  });

  it("marks execution as failed when queue retries are exhausted", async () => {
    const queue = new TestQueue();
    const { service, failExecutionDeliveryExhausted } = createService({
      processExecution: async () => {
        throw genericError.new({ message: "boom" });
      },
    });

    const worker = new DurableWorker(service, queue, createSilentLogger());
    await worker.start();

    await queue.handler?.({
      ...message({ executionId: "e1" }, "resume"),
      attempts: 1,
      maxAttempts: 1,
    });

    expect(queue.nackCalls).toEqual([{ id: "m1", requeue: false }]);
    expect(failExecutionDeliveryExhausted).toHaveBeenCalledWith("e1", {
      messageId: "m1",
      attempts: 1,
      maxAttempts: 1,
      errorMessage: "boom",
    });
  });

  it("requeues exhausted messages when terminalization fails", async () => {
    const queue = new TestQueue();
    const { service, failExecutionDeliveryExhausted } = createService({
      processExecution: async () => {
        throw genericError.new({ message: "boom" });
      },
      failExecutionDeliveryExhausted: async () => {
        throw genericError.new({ message: "terminalization failed" });
      },
    });

    const worker = new DurableWorker(service, queue, createSilentLogger());
    await worker.start();

    await queue.handler?.({
      ...message({ executionId: "e1" }, "resume"),
      attempts: 1,
      maxAttempts: 1,
    });

    expect(failExecutionDeliveryExhausted).toHaveBeenCalledWith("e1", {
      messageId: "m1",
      attempts: 1,
      maxAttempts: 1,
      errorMessage: "boom",
    });
    expect(queue.nackCalls).toEqual([{ id: "m1", requeue: true }]);
  });

  it("forwards non-Error failures as string messages", async () => {
    const queue = new TestQueue();
    const { service, failExecutionDeliveryExhausted } = createService({
      processExecution: async () => {
        throw "plain boom";
      },
    });

    const worker = new DurableWorker(service, queue, createSilentLogger());
    await worker.start();

    await queue.handler?.({
      ...message({ executionId: "e1" }, "resume"),
      attempts: 1,
      maxAttempts: 1,
    });

    expect(failExecutionDeliveryExhausted).toHaveBeenCalledWith("e1", {
      messageId: "m1",
      attempts: 1,
      maxAttempts: 1,
      errorMessage: "plain boom",
    });
    expect(queue.nackCalls).toEqual([{ id: "m1", requeue: false }]);
  });

  it("drops exhausted messages when processing fails before an execution id can be derived", async () => {
    const queue = new TestQueue();
    const { service, failExecutionDeliveryExhausted } = createService();

    const worker = new DurableWorker(service, queue, createSilentLogger());
    jest
      .spyOn(
        worker as never as { handleMessage: () => Promise<void> },
        "handleMessage",
      )
      .mockRejectedValue(genericError.new({ message: "boom" }));
    await worker.start();

    await queue.handler?.({
      ...message("bad-payload", "resume"),
      attempts: 1,
      maxAttempts: 1,
    });

    expect(failExecutionDeliveryExhausted).not.toHaveBeenCalled();
    expect(queue.nackCalls).toEqual([{ id: "m1", requeue: false }]);
  });

  it("uses a fallback logger when logger is omitted", async () => {
    const queue = new TestQueue();
    const { service, processExecution } = createService();

    const worker = new DurableWorker(service, queue);
    await worker.start();

    await queue.handler?.(message({ executionId: "e1" }, "execute"));

    expect(processExecution).toHaveBeenCalledWith("e1");
    expect(queue.ackCalls).toEqual(["m1"]);
  });

  it("ignores unknown payload shapes", async () => {
    const queue = new TestQueue();
    const { service, processExecution } = createService();

    const worker = new DurableWorker(service, queue, createSilentLogger());
    await worker.start();

    await queue.handler?.(message("bad", "execute"));
    await queue.handler?.(message({ executionId: 123 }, "execute"));
    expect(processExecution).not.toHaveBeenCalled();
    expect(queue.ackCalls).toEqual(["m1", "m1"]);
  });

  it("ignores non-execution message types", async () => {
    const queue = new TestQueue();
    const { service, processExecution } = createService();

    const worker = new DurableWorker(service, queue, createSilentLogger());
    await worker.start();

    await queue.handler?.(message({ executionId: "e1" }, "schedule"));
    expect(processExecution).toHaveBeenCalledWith("e1");
    expect(queue.ackCalls).toEqual(["m1"]);
  });

  it("acks unsupported message types without processing executions", async () => {
    const queue = new TestQueue();
    const { service, processExecution } = createService();

    const worker = new DurableWorker(service, queue, createSilentLogger());
    await worker.start();

    const unknown = { ...message({ executionId: "e1" }, "execute"), type: "x" };
    await queue.handler?.(unknown as QueueMessage);

    expect(processExecution).not.toHaveBeenCalled();
    expect(queue.ackCalls).toEqual(["m1"]);
  });
});
