import * as amqplibModule from "../../durable/optionalDeps/amqplib";
import { RabbitMQEventLaneQueue } from "../../event-lanes/RabbitMQEventLaneQueue";

type ChannelMock = {
  assertQueue: jest.Mock;
  checkQueue: jest.Mock;
  prefetch: jest.Mock;
  sendToQueue: jest.Mock;
  consume: jest.Mock;
  cancel: jest.Mock;
  ack: jest.Mock;
  nack: jest.Mock;
  close: jest.Mock;
};

type ConnectionMock = {
  createChannel: jest.Mock;
  close: jest.Mock;
};

describe("event-lanes: RabbitMQEventLaneQueue", () => {
  let channelMock: ChannelMock;
  let connMock: ConnectionMock;
  let queue: RabbitMQEventLaneQueue;
  let loggerError: jest.Mock;

  beforeEach(() => {
    channelMock = {
      assertQueue: jest.fn().mockResolvedValue({}),
      checkQueue: jest.fn().mockResolvedValue({}),
      prefetch: jest.fn().mockResolvedValue({}),
      sendToQueue: jest.fn().mockResolvedValue(true),
      consume: jest.fn().mockResolvedValue({ consumerTag: "tag" }),
      cancel: jest.fn().mockResolvedValue({}),
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
    queue = new RabbitMQEventLaneQueue({
      url: "amqp://localhost",
      queue: {
        name: "event-lanes",
        quorum: true,
        deadLetter: "event-lanes.dlq",
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
    expect(channelMock.assertQueue).toHaveBeenCalledWith(
      "event-lanes.dlq",
      expect.objectContaining({ durable: true }),
    );

    await queue.consume(async () => {});
    expect(channelMock.consume).toHaveBeenCalled();
  });

  it("enqueues messages", async () => {
    await queue.init();
    await queue.enqueue({
      laneId: "lane.a",
      eventId: "event.a",
      payload: '{"x":1}',
      source: { kind: "runtime", id: "tests" },
      maxAttempts: 3,
    });
    expect(channelMock.sendToQueue).toHaveBeenCalled();
  });

  it("acks and nacks messages", async () => {
    await queue.init();
    let consumer:
      | ((msg: { content: Buffer } | null) => Promise<void>)
      | undefined;
    channelMock.consume.mockImplementation(async (_q: string, h: any) => {
      consumer = h;
    });

    await queue.consume(async () => {});
    const msgId = "msg-1";
    const amqpMsg = {
      content: Buffer.from(
        JSON.stringify({
          id: msgId,
          laneId: "lane.a",
          eventId: "event.a",
          payload: '{"x":1}',
          source: { kind: "runtime", id: "tests" },
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date().toISOString(),
        }),
      ),
    };

    await consumer?.(amqpMsg);
    await queue.ack(msgId);
    expect(channelMock.ack).toHaveBeenCalledWith(amqpMsg);

    await consumer?.(amqpMsg);
    await queue.nack(msgId, false);
    expect(channelMock.nack).toHaveBeenCalledWith(amqpMsg, false, false);
  });

  it("falls back to broker nack requeue when message is not tracked", async () => {
    await queue.init();

    let consumer:
      | ((msg: { content: Buffer } | null) => Promise<void>)
      | undefined;
    channelMock.consume.mockImplementation(async (_q: string, h: any) => {
      consumer = h;
    });

    await queue.consume(async () => {
      return;
    });

    const amqpMsg = {
      content: Buffer.from(
        JSON.stringify({
          id: "msg-requeue-fallback",
          laneId: "lane.a",
          eventId: "event.a",
          payload: "{}",
          source: { kind: "runtime", id: "tests" },
          attempts: 2,
          maxAttempts: 3,
          createdAt: new Date().toISOString(),
        }),
      ),
    };

    await consumer?.(amqpMsg);

    (
      queue as unknown as { messagesById: Map<string, unknown> }
    ).messagesById.delete("msg-requeue-fallback");

    await queue.nack("msg-requeue-fallback", true);

    expect(channelMock.nack).toHaveBeenCalledWith(amqpMsg, false, true);
  });

  it("throws if used before init", async () => {
    await expect(
      queue.enqueue({
        laneId: "lane.a",
        eventId: "event.a",
        payload: '{"x":1}',
        source: { kind: "runtime", id: "tests" },
        maxAttempts: 1,
      }),
    ).rejects.toThrow("Event lane queue not initialized");

    await expect(queue.consume(async () => {})).rejects.toThrow(
      "Event lane queue not initialized",
    );
  });

  it("nacks malformed messages and reports parse failure", async () => {
    await queue.init();
    let consumer:
      | ((msg: { content: Buffer } | null) => Promise<void>)
      | undefined;
    channelMock.consume.mockImplementation(async (_q: string, h: any) => {
      consumer = h;
    });

    const handler = jest.fn();
    await queue.consume(handler);

    await consumer?.({ content: Buffer.from("{bad-json}") });
    expect(handler).not.toHaveBeenCalled();
    expect(channelMock.nack).toHaveBeenCalledWith(
      expect.anything(),
      false,
      false,
    );
    expect(loggerError).toHaveBeenCalledWith(
      "RabbitMQEventLaneQueue failed to parse incoming message; nacking without requeue.",
      expect.objectContaining({
        error: expect.any(Error),
      }),
    );
  });

  it("nacks messages without required fields", async () => {
    await queue.init();
    let consumer:
      | ((msg: { content: Buffer } | null) => Promise<void>)
      | undefined;
    channelMock.consume.mockImplementation(async (_q: string, h: any) => {
      consumer = h;
    });
    const handler = jest.fn();
    await queue.consume(handler);

    await consumer?.({
      content: Buffer.from(JSON.stringify({ id: "msg-2", payload: "{}" })),
    });

    expect(handler).not.toHaveBeenCalled();
    expect(channelMock.nack).toHaveBeenCalledWith(
      expect.anything(),
      false,
      false,
    );
  });

  it("disposes connections", async () => {
    await queue.init();
    await queue.consume(async () => {});
    await queue.dispose();
    expect(channelMock.cancel).toHaveBeenCalledWith("tag");
    expect(channelMock.close).toHaveBeenCalled();
    expect(connMock.close).toHaveBeenCalled();
  });

  it("cancels consumer on cooldown", async () => {
    await queue.init();
    await queue.consume(async () => {});
    await queue.cooldown();
    expect(channelMock.cancel).toHaveBeenCalledWith("tag");
  });

  it("requeues consumed message when cooldown was activated", async () => {
    await queue.init();
    let consumer:
      | ((msg: { content: Buffer } | null) => Promise<void>)
      | undefined;
    channelMock.consume.mockImplementation(async (_q: string, h: any) => {
      consumer = h;
      return { consumerTag: "tag" };
    });

    const handler = jest.fn();
    await queue.consume(handler);
    await queue.cooldown();

    const amqpMsg = {
      content: Buffer.from(
        JSON.stringify({
          id: "msg-cooldown",
          laneId: "lane.a",
          eventId: "event.a",
          payload: "{}",
          source: { kind: "runtime", id: "tests" },
          attempts: 0,
          maxAttempts: 1,
          createdAt: new Date().toISOString(),
        }),
      ),
    };

    await consumer?.(amqpMsg);
    expect(handler).not.toHaveBeenCalled();
    expect(channelMock.ack).toHaveBeenCalledWith(amqpMsg);
    expect(channelMock.sendToQueue).toHaveBeenCalledWith(
      "event-lanes",
      expect.any(Buffer),
      expect.any(Object),
    );
  });

  it("supports legacy queueName defaults and setPrefetch()", async () => {
    const legacyQueue = new RabbitMQEventLaneQueue({
      queueName: "event-lanes-legacy",
    });
    await legacyQueue.init();
    expect(channelMock.assertQueue).toHaveBeenCalledWith(
      "event-lanes-legacy",
      expect.objectContaining({
        durable: true,
        arguments: expect.objectContaining({ "x-queue-type": "quorum" }),
      }),
    );

    await legacyQueue.setPrefetch(7);
    expect(channelMock.prefetch).toHaveBeenLastCalledWith(7);
  });

  it("supports default queue config when none is provided", async () => {
    const defaultsQueue = new RabbitMQEventLaneQueue({});
    await defaultsQueue.init();
    expect(channelMock.assertQueue).toHaveBeenCalledWith(
      "runner_event_lanes",
      expect.anything(),
    );
  });

  it("nacks messages without id and skips handler", async () => {
    await queue.init();
    let consumer:
      | ((msg: { content: Buffer } | null) => Promise<void>)
      | undefined;
    channelMock.consume.mockImplementation(async (_q: string, h: any) => {
      consumer = h;
    });
    const handler = jest.fn();
    await queue.consume(handler);

    await consumer?.({
      content: Buffer.from(
        JSON.stringify({
          laneId: "lane.a",
          eventId: "event.a",
          payload: "{}",
          source: { kind: "runtime", id: "tests" },
        }),
      ),
    });

    expect(handler).not.toHaveBeenCalled();
    expect(channelMock.nack).toHaveBeenCalledWith(
      expect.anything(),
      false,
      false,
    );
  });

  it("reports invalid source as malformed payload", async () => {
    await queue.init();
    let consumer:
      | ((msg: { content: Buffer } | null) => Promise<void>)
      | undefined;
    channelMock.consume.mockImplementation(async (_q: string, h: any) => {
      consumer = h;
    });
    await queue.consume(async () => {});

    await consumer?.({
      content: Buffer.from(
        JSON.stringify({
          id: "msg-invalid-source",
          laneId: "lane.a",
          eventId: "event.a",
          payload: "{}",
          source: "bad-source",
        }),
      ),
    });

    expect(channelMock.nack).toHaveBeenCalledWith(
      expect.anything(),
      false,
      false,
    );
    expect(loggerError).toHaveBeenCalledWith(
      "RabbitMQEventLaneQueue failed to parse incoming message; nacking without requeue.",
      expect.objectContaining({
        error: expect.any(Error),
      }),
    );
  });

  it("normalizes optional attempts/maxAttempts/createdAt fields", async () => {
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
          id: "msg-defaults",
          laneId: "lane.a",
          eventId: "event.a",
          payload: "{}",
          source: { kind: "runtime", id: "tests" },
        }),
      ),
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "msg-defaults",
        attempts: 1,
        maxAttempts: 1,
        createdAt: expect.any(Date),
      }),
    );

    await queue.nack("msg-defaults");
    expect(channelMock.ack).toHaveBeenCalledWith(expect.anything());
    const lastPublishCall =
      channelMock.sendToQueue.mock.calls[
        channelMock.sendToQueue.mock.calls.length - 1
      ];
    const republishedPayload = JSON.parse(lastPublishCall[1].toString()) as {
      id: string;
      attempts: number;
      maxAttempts: number;
    };
    expect(republishedPayload.id).toBe("msg-defaults");
    expect(republishedPayload.attempts).toBe(1);
    expect(republishedPayload.maxAttempts).toBe(1);
  });

  it("forwards durable/assert/arguments and publishOptions to transport", async () => {
    const configuredQueue = new RabbitMQEventLaneQueue({
      queue: {
        name: "event-lanes.configured",
        durable: false,
        assert: "active",
        quorum: false,
        deadLetter: {
          queue: "event-lanes.configured.dlq",
          exchange: "event-lanes.dlx",
          routingKey: "event-lanes.failed",
        },
        arguments: {
          "x-max-length": 500,
        },
      },
      publishOptions: {
        persistent: false,
      },
    });

    await configuredQueue.init();

    expect(channelMock.assertQueue).toHaveBeenCalledWith(
      "event-lanes.configured.dlq",
      expect.objectContaining({ durable: false }),
    );
    expect(channelMock.assertQueue).toHaveBeenCalledWith(
      "event-lanes.configured",
      expect.objectContaining({
        durable: false,
        arguments: expect.objectContaining({
          "x-max-length": 500,
          "x-dead-letter-exchange": "event-lanes.dlx",
          "x-dead-letter-routing-key": "event-lanes.failed",
        }),
      }),
    );

    await configuredQueue.enqueue({
      laneId: "lane.configured",
      eventId: "event.configured",
      payload: "{}",
      source: { kind: "runtime", id: "tests" },
      maxAttempts: 1,
    });

    expect(channelMock.sendToQueue).toHaveBeenCalledWith(
      "event-lanes.configured",
      expect.any(Buffer),
      expect.objectContaining({ persistent: false }),
    );
  });
});
