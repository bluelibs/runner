import { connect } from "amqplib";
import { RabbitMQQueue } from "../queue/RabbitMQQueue";

jest.mock("amqplib");

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
    (connect as unknown as jest.Mock).mockResolvedValue(connMock);
    queue = new RabbitMQQueue({
      url: "amqp://localhost",
      queue: {
        name: "test",
        quorum: true,
        deadLetter: "dlq",
        messageTtl: 1000,
      },
    });
  });

  it("initializes and registers consumer", async () => {
    await queue.init();
    expect(connect).toHaveBeenCalled();
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
