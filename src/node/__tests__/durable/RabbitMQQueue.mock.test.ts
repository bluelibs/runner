import { RabbitMQQueue } from "../../durable/queue/RabbitMQQueue";
import * as amqplibModule from "../../durable/optionalDeps/amqplib";

type ChannelMock = {
  assertQueue: jest.Mock;
  prefetch: jest.Mock;
  sendToQueue: jest.Mock;
  consume: jest.Mock;
  ack: jest.Mock;
  nack: jest.Mock;
  close: jest.Mock;
};

type ConnectionMock = {
  createChannel: jest.Mock;
  close: jest.Mock;
};

describe("durable: RabbitMQQueue", () => {
  let channelMock: ChannelMock;
  let connMock: ConnectionMock;
  let queue: RabbitMQQueue;
  let loggerError: jest.Mock;

  beforeEach(() => {
    channelMock = {
      assertQueue: jest.fn().mockResolvedValue({}),
      prefetch: jest.fn().mockResolvedValue({}),
      sendToQueue: jest.fn().mockResolvedValue(true),
      consume: jest.fn().mockResolvedValue({ consumerTag: "tag" }),
      ack: jest.fn(),
      nack: jest.fn(),
      close: jest.fn().mockResolvedValue({}),
    };
    connMock = {
      createChannel: jest.fn().mockResolvedValue(channelMock),
      close: jest.fn().mockResolvedValue({}),
    };
    jest
      .spyOn(amqplibModule, "connectAmqplib")
      .mockResolvedValue(connMock as any);
    loggerError = jest.fn();
    queue = new RabbitMQQueue({
      url: "amqp://localhost",
      queue: {
        name: "test",
        quorum: true,
        deadLetter: "dlq",
        messageTtl: 1000,
      },
      logger: { error: loggerError },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("initializes and registers consumer", async () => {
    await queue.init();
    expect(amqplibModule.connectAmqplib).toHaveBeenCalled();
    expect(channelMock.assertQueue).toHaveBeenCalled();
    expect(channelMock.assertQueue).toHaveBeenCalledWith(
      "dlq",
      expect.objectContaining({ durable: true }),
    );

    await queue.consume(async () => {});
    expect(channelMock.consume).toHaveBeenCalled();
  });

  it("enqueues messages", async () => {
    await queue.init();
    await queue.enqueue({ type: "execute", payload: { x: 1 }, maxAttempts: 3 });
    expect(channelMock.sendToQueue).toHaveBeenCalled();
  });

  it("acks and nacks", async () => {
    await queue.init();

    let consumer:
      | ((msg: { content: Buffer } | null) => Promise<void>)
      | undefined;
    channelMock.consume.mockImplementation(async (_q: string, h: any) => {
      consumer = h;
    });

    await queue.consume(async () => {});

    const msgId = "123";
    const amqpMsg = {
      content: Buffer.from(JSON.stringify({ id: msgId })),
    };

    await consumer?.(amqpMsg);

    await queue.ack(msgId);
    expect(channelMock.ack).toHaveBeenCalledWith(amqpMsg);

    await consumer?.(amqpMsg);
    await queue.nack(msgId, false);
    expect(channelMock.nack).toHaveBeenCalledWith(amqpMsg, false, false);

    await queue.ack("missing");
    await queue.nack("missing");
  });

  it("throws if used before init", async () => {
    await expect(
      queue.enqueue({ type: "execute", payload: {}, maxAttempts: 1 }),
    ).rejects.toThrow("Queue not initialized");

    await expect(queue.consume(async () => {})).rejects.toThrow(
      "Queue not initialized",
    );
  });

  it("ignores null messages from the broker", async () => {
    await queue.init();
    let consumer:
      | ((msg: { content: Buffer } | null) => Promise<void>)
      | undefined;
    channelMock.consume.mockImplementation(async (_q: string, h: any) => {
      consumer = h;
    });
    await queue.consume(async () => {});

    await expect(consumer?.(null)).resolves.toBeUndefined();
  });

  it("nacks malformed JSON messages and skips handler", async () => {
    await queue.init();
    let consumer:
      | ((msg: { content: Buffer } | null) => Promise<void>)
      | undefined;
    channelMock.consume.mockImplementation(async (_q: string, h: any) => {
      consumer = h;
    });

    const handler = jest.fn();
    await queue.consume(handler);

    await consumer?.({ content: Buffer.from("{invalid-json}") });

    expect(handler).not.toHaveBeenCalled();
    expect(channelMock.nack).toHaveBeenCalledWith(
      expect.anything(),
      false,
      false,
    );
    expect(loggerError).toHaveBeenCalledWith(
      "RabbitMQQueue failed to parse incoming message; nacking without requeue.",
      expect.objectContaining({
        error: expect.any(Error),
      }),
    );
  });

  it("increments attempts before passing messages to the handler", async () => {
    await queue.init();
    let consumer:
      | ((msg: { content: Buffer } | null) => Promise<void>)
      | undefined;
    channelMock.consume.mockImplementation(async (_q: string, h: any) => {
      consumer = h;
    });

    const handler = jest.fn(async () => {});
    await queue.consume(handler);

    await consumer?.({
      content: Buffer.from(
        JSON.stringify({
          id: "attempt-msg",
          type: "execute",
          payload: { a: 1 },
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date().toISOString(),
        }),
      ),
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "attempt-msg",
        attempts: 1,
      }),
    );
  });

  it("nacks messages without a valid id and skips handler", async () => {
    await queue.init();
    let consumer:
      | ((msg: { content: Buffer } | null) => Promise<void>)
      | undefined;
    channelMock.consume.mockImplementation(async (_q: string, h: any) => {
      consumer = h;
    });

    const handler = jest.fn();
    await queue.consume(handler);

    await consumer?.({ content: Buffer.from(JSON.stringify({ payload: 1 })) });

    expect(handler).not.toHaveBeenCalled();
    expect(channelMock.nack).toHaveBeenCalledWith(
      expect.anything(),
      false,
      false,
    );
  });

  it("normalizes primitive parse failures before reporting", async () => {
    await queue.init();
    let consumer:
      | ((msg: { content: Buffer } | null) => Promise<void>)
      | undefined;
    channelMock.consume.mockImplementation(async (_q: string, h: any) => {
      consumer = h;
    });
    await queue.consume(async () => {});

    const parseSpy = jest
      .spyOn(JSON, "parse")
      .mockImplementationOnce((): never => {
        throw "primitive-parse-error";
      });
    try {
      await consumer?.({ content: Buffer.from('{"id":"x"}') });
    } finally {
      parseSpy.mockRestore();
    }

    expect(loggerError).toHaveBeenCalledWith(
      "RabbitMQQueue failed to parse incoming message; nacking without requeue.",
      expect.objectContaining({
        error: expect.any(Error),
      }),
    );
  });

  it("reports primitive handler failures and preserves consumer ack/nack control", async () => {
    await queue.init();
    let consumer:
      | ((msg: { content: Buffer } | null) => Promise<void>)
      | undefined;
    channelMock.consume.mockImplementation(async (_q: string, h: any) => {
      consumer = h;
    });
    await queue.consume(async () => {
      throw "primitive-handler-error";
    });

    await consumer?.({
      content: Buffer.from(
        JSON.stringify({
          id: "handler-primitive",
          type: "execute",
          payload: {},
          attempts: 0,
          maxAttempts: 1,
          createdAt: new Date().toISOString(),
        }),
      ),
    });

    expect(loggerError).toHaveBeenCalledWith(
      "RabbitMQQueue handler threw; leaving ack/nack to consumer.",
      expect.objectContaining({
        error: expect.any(Error),
        messageId: "handler-primitive",
      }),
    );
    expect(channelMock.nack).not.toHaveBeenCalled();
  });

  it("reports Error handler failures without wrapping", async () => {
    await queue.init();
    let consumer:
      | ((msg: { content: Buffer } | null) => Promise<void>)
      | undefined;
    channelMock.consume.mockImplementation(async (_q: string, h: any) => {
      consumer = h;
    });
    const handlerError = new Error("handler-error");
    await queue.consume(async () => {
      throw handlerError;
    });

    await consumer?.({
      content: Buffer.from(
        JSON.stringify({
          id: "handler-error-id",
          type: "execute",
          payload: {},
          attempts: 0,
          maxAttempts: 1,
          createdAt: new Date().toISOString(),
        }),
      ),
    });

    expect(loggerError).toHaveBeenCalledWith(
      "RabbitMQQueue handler threw; leaving ack/nack to consumer.",
      expect.objectContaining({
        error: handlerError,
        messageId: "handler-error-id",
      }),
    );
  });

  it("disposes connections", async () => {
    await queue.init();
    await queue.dispose();
    expect(channelMock.close).toHaveBeenCalled();
    expect(connMock.close).toHaveBeenCalled();
  });

  it("supports legacy queueName and non-quorum queues", async () => {
    const legacy = new RabbitMQQueue({
      queueName: "legacy",
      queue: { quorum: false },
    });
    await legacy.init();
    expect(channelMock.assertQueue).toHaveBeenCalledWith(
      "legacy",
      expect.objectContaining({
        durable: true,
        arguments: expect.not.objectContaining({ "x-queue-type": "quorum" }),
      }),
    );
  });

  it("supports defaults when no config is provided", async () => {
    const q = new RabbitMQQueue({});
    await q.init();
    expect(channelMock.assertQueue).toHaveBeenCalledWith(
      "durable_executions",
      expect.anything(),
    );
  });
});
