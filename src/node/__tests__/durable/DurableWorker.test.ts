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
  public cancelConsumerCalls = 0;

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

  async cancelConsumer(): Promise<void> {
    this.cancelConsumerCalls += 1;
    this.handler = null;
  }
}

class FailingConsumeQueue extends TestQueue {
  constructor(private remainingFailures: number) {
    super();
  }

  override async consume<T>(handler: MessageHandler<T>): Promise<void> {
    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      throw genericError.new({ message: "consume failed" });
    }

    await super.consume(handler);
  }
}

class CancelFailQueue extends TestQueue {
  override async cancelConsumer(): Promise<void> {
    this.cancelConsumerCalls += 1;
    this.handler = null;
    throw genericError.new({ message: "cancel failed" });
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

  it("allows start() to be retried after queue.consume() fails during startup", async () => {
    const queue = new FailingConsumeQueue(1);
    const { service } = createService();

    const worker = new DurableWorker(service, queue, createSilentLogger());

    await expect(worker.start()).rejects.toThrow("consume failed");
    await expect(worker.start()).resolves.toBeUndefined();

    expect(queue.handler).not.toBeNull();
  });

  it("treats repeated successful start() calls as idempotent", async () => {
    const queue = new TestQueue();
    const consumeSpy = jest.spyOn(queue, "consume");
    const { service } = createService();

    const worker = new DurableWorker(service, queue, createSilentLogger());

    await worker.start();
    await worker.start();

    expect(consumeSpy).toHaveBeenCalledTimes(1);
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

  it("nacks malformed payload shapes instead of acknowledging them", async () => {
    const queue = new TestQueue();
    const { service, processExecution } = createService();

    const worker = new DurableWorker(service, queue, createSilentLogger());
    await worker.start();

    await queue.handler?.(message("bad", "execute"));
    await queue.handler?.(message({ executionId: 123 }, "execute"));
    expect(processExecution).not.toHaveBeenCalled();
    expect(queue.ackCalls).toEqual([]);
    expect(queue.nackCalls).toEqual([
      { id: "m1", requeue: true },
      { id: "m1", requeue: true },
    ]);
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

  it("nacks unsupported message types instead of dropping them", async () => {
    const queue = new TestQueue();
    const { service, processExecution } = createService();

    const worker = new DurableWorker(service, queue, createSilentLogger());
    await worker.start();

    const unknown = { ...message({ executionId: "e1" }, "execute"), type: "x" };
    await queue.handler?.(unknown as QueueMessage);

    expect(processExecution).not.toHaveBeenCalled();
    expect(queue.ackCalls).toEqual([]);
    expect(queue.nackCalls).toEqual([{ id: "m1", requeue: true }]);
  });

  it("stops the active queue consumer when the worker stops", async () => {
    const queue = new TestQueue();
    const { service } = createService();

    const worker = new DurableWorker(service, queue, createSilentLogger());
    await worker.start();
    await worker.stop();

    expect(queue.cancelConsumerCalls).toBe(1);
    expect(queue.handler).toBeNull();
  });

  it("waits for the in-flight message to settle before stop() returns", async () => {
    const queue = new TestQueue();
    let releaseExecution!: () => void;
    const executionBlocked = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    const { service } = createService({
      processExecution: async () => {
        await executionBlocked;
      },
    });

    const worker = new DurableWorker(service, queue, createSilentLogger());
    await worker.start();

    const handlerPromise = queue.handler?.(
      message({ executionId: "e1" }, "execute"),
    );
    expect(handlerPromise).toBeDefined();

    await Promise.resolve();

    let stopped = false;
    const stopPromise = worker.stop().then(() => {
      stopped = true;
    });

    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(queue.cancelConsumerCalls).toBe(1);

    releaseExecution();

    await stopPromise;
    await handlerPromise;

    expect(stopped).toBe(true);
    expect(queue.ackCalls).toEqual(["m1"]);
  });

  it("waits for in-flight messages even when cancelConsumer() fails", async () => {
    const queue = new CancelFailQueue();
    let releaseExecution!: () => void;
    const executionBlocked = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    const { service } = createService({
      processExecution: async () => {
        await executionBlocked;
      },
    });

    const worker = new DurableWorker(service, queue, createSilentLogger());
    await worker.start();

    const handlerPromise = queue.handler?.(
      message({ executionId: "e1" }, "execute"),
    );
    expect(handlerPromise).toBeDefined();

    await Promise.resolve();

    let settled = false;
    const stopPromise = worker.stop().finally(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(queue.cancelConsumerCalls).toBe(1);

    releaseExecution();

    await expect(stopPromise).rejects.toThrow("cancel failed");
    await handlerPromise;

    expect(queue.ackCalls).toEqual(["m1"]);
  });

  it("preserves cooldown failures when draining in-flight messages also fails", async () => {
    const queue = new CancelFailQueue();
    const { service } = createService();
    const worker = new DurableWorker(service, queue, createSilentLogger());
    const waitError = genericError.new({ message: "wait failed" });

    jest
      .spyOn(
        worker as unknown as { waitForInFlightMessages: () => Promise<void> },
        "waitForInFlightMessages",
      )
      .mockRejectedValue(waitError);

    await expect(worker.stop()).rejects.toThrow("cancel failed");
  });

  it("rethrows drain failures when cooldown succeeds", async () => {
    const queue = new TestQueue();
    const { service } = createService();
    const worker = new DurableWorker(service, queue, createSilentLogger());
    const waitError = genericError.new({ message: "wait failed" });

    jest
      .spyOn(
        worker as unknown as { waitForInFlightMessages: () => Promise<void> },
        "waitForInFlightMessages",
      )
      .mockRejectedValue(waitError);

    await expect(worker.stop()).rejects.toThrow("wait failed");
  });
});
