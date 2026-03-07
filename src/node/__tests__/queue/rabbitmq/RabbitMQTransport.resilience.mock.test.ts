import * as amqplibModule from "../../../durable/optionalDeps/amqplib";
import { RabbitMQTransport } from "../../../queue/rabbitmq/RabbitMQTransport";

type ChannelMock = {
  assertQueue: jest.Mock;
  checkQueue?: jest.Mock;
  prefetch: jest.Mock;
  sendToQueue: jest.Mock;
  waitForConfirms?: jest.Mock;
  consume: jest.Mock;
  cancel: jest.Mock;
  ack: jest.Mock;
  nack: jest.Mock;
  close: jest.Mock;
  on?: jest.Mock;
};

type ConnectionMock = {
  createChannel: jest.Mock;
  createConfirmChannel?: jest.Mock;
  close: jest.Mock;
  on?: jest.Mock;
};

type ListenerStore = Record<string, (error?: unknown) => void>;

const createChannelMock = (
  overrides: Partial<ChannelMock> = {},
  listeners?: ListenerStore,
): ChannelMock => ({
  assertQueue: jest.fn().mockResolvedValue({}),
  checkQueue: jest.fn().mockResolvedValue({}),
  prefetch: jest.fn().mockResolvedValue({}),
  sendToQueue: jest.fn().mockResolvedValue(true),
  consume: jest.fn().mockResolvedValue({ consumerTag: "tag" }),
  cancel: jest.fn().mockResolvedValue({}),
  ack: jest.fn(),
  nack: jest.fn(),
  close: jest.fn().mockResolvedValue({}),
  on: listeners
    ? jest.fn((event: string, handler: (error?: unknown) => void) => {
        listeners[event] = handler;
      })
    : jest.fn(),
  ...overrides,
});

const createConnectionMock = (
  channel: ChannelMock,
  overrides: Partial<ConnectionMock> = {},
  listeners?: ListenerStore,
): ConnectionMock => ({
  createChannel: jest.fn().mockResolvedValue(channel),
  close: jest.fn().mockResolvedValue({}),
  on: listeners
    ? jest.fn((event: string, handler: (error?: unknown) => void) => {
        listeners[event] = handler;
      })
    : jest.fn(),
  ...overrides,
});

const createTransport = (overrides: Record<string, unknown> = {}) =>
  new RabbitMQTransport<{ id?: string }>({
    queue: { name: "transport.resilience" },
    parseFailureLogMessage: "parse-failed",
    handlerFailureLogMessage: "handler-failed",
    decode: (content) => JSON.parse(content.toString()) as { id?: string },
    resolveMessageId: (message) => message.id,
    throwNotInitialized: () => {
      throw new Error("transport not initialized");
    },
    ...overrides,
  });

describe("node: RabbitMQTransport resilience", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("retries setup failures with backoff and then initializes", async () => {
    const loggerError = jest.fn();
    const channel = createChannelMock();
    const connection = createConnectionMock(channel);

    const connectSpy = jest
      .spyOn(amqplibModule, "connectAmqplib")
      .mockRejectedValueOnce(new Error("temporary-unavailable"))
      .mockResolvedValueOnce(connection as any);

    const transport = createTransport({
      logger: { error: loggerError },
      reconnect: {
        enabled: true,
        maxAttempts: 3,
        initialDelayMs: 0,
        maxDelayMs: 0,
      },
    });

    await transport.init();

    expect(connectSpy).toHaveBeenCalledTimes(2);
    expect(loggerError).toHaveBeenCalledWith(
      "RabbitMQ transport connection attempt failed; retrying.",
      expect.objectContaining({
        reason: "init",
        attempt: 1,
        maxAttempts: 3,
      }),
    );
  });

  it("fails fast on init when reconnect is disabled", async () => {
    jest
      .spyOn(amqplibModule, "connectAmqplib")
      .mockRejectedValue(new Error("initial-connect-failed"));

    const transport = createTransport({
      reconnect: {
        enabled: false,
      },
    });

    await expect(transport.init()).rejects.toThrow("initial-connect-failed");
  });

  it("recovers publish and ignores previous close failures during reconnection", async () => {
    const channelA = createChannelMock({
      sendToQueue: jest.fn(() => {
        throw new Error("channel-a-closed");
      }),
      close: jest.fn().mockRejectedValue(new Error("channel-a-close-fail")),
    });
    const channelB = createChannelMock();
    const connectionA = createConnectionMock(channelA, {
      close: jest.fn().mockRejectedValue(new Error("conn-a-close-fail")),
    });
    const connectionB = createConnectionMock(channelB);

    const connectSpy = jest
      .spyOn(amqplibModule, "connectAmqplib")
      .mockResolvedValueOnce(connectionA as any)
      .mockResolvedValueOnce(connectionB as any);

    const transport = createTransport({
      reconnect: {
        enabled: true,
        maxAttempts: 2,
        initialDelayMs: 0,
        maxDelayMs: 0,
      },
    });

    await transport.init();
    await transport.publish(Buffer.from('{"id":"recover"}'));

    expect(connectSpy).toHaveBeenCalledTimes(2);
    expect(channelB.sendToQueue).toHaveBeenCalledWith(
      "transport.resilience",
      expect.any(Buffer),
      expect.any(Object),
    );
  });

  it("registers channel and connection disconnect handlers", async () => {
    const loggerError = jest.fn();
    const channelListeners: ListenerStore = {};
    const connectionListeners: ListenerStore = {};
    const channel = createChannelMock({}, channelListeners);
    const connection = createConnectionMock(channel, {}, connectionListeners);
    jest
      .spyOn(amqplibModule, "connectAmqplib")
      .mockResolvedValue(connection as any);

    const transport = createTransport({
      logger: { error: loggerError },
    });

    await transport.init();

    connectionListeners.close?.();
    connectionListeners.error?.(new Error("conn-error"));
    channelListeners.close?.();
    channelListeners.error?.(new Error("channel-error"));

    expect(loggerError).toHaveBeenCalledWith(
      "RabbitMQ transport connection dropped.",
      expect.objectContaining({ source: "connection.close" }),
    );
    expect(loggerError).toHaveBeenCalledWith(
      "RabbitMQ transport connection dropped.",
      expect.objectContaining({ source: "connection.error" }),
    );
    expect(loggerError).toHaveBeenCalledWith(
      "RabbitMQ transport connection dropped.",
      expect.objectContaining({ source: "channel.close" }),
    );
    expect(loggerError).toHaveBeenCalledWith(
      "RabbitMQ transport connection dropped.",
      expect.objectContaining({ source: "channel.error" }),
    );
  });

  it("ignores stale disconnect handlers after dispose", async () => {
    const loggerError = jest.fn();
    const channelListeners: ListenerStore = {};
    const connectionListeners: ListenerStore = {};
    const channel = createChannelMock({}, channelListeners);
    const connection = createConnectionMock(channel, {}, connectionListeners);
    jest
      .spyOn(amqplibModule, "connectAmqplib")
      .mockResolvedValue(connection as any);

    const transport = createTransport({
      logger: { error: loggerError },
    });

    await transport.init();
    await transport.dispose();
    connectionListeners.close?.();
    channelListeners.error?.(new Error("ignored"));

    expect(loggerError).not.toHaveBeenCalledWith(
      "RabbitMQ transport connection dropped.",
      expect.any(Object),
    );
  });

  it("throws not-initialized from forced recovery when recovery is disabled", async () => {
    const channel = createChannelMock();
    const connection = createConnectionMock(channel);
    jest
      .spyOn(amqplibModule, "connectAmqplib")
      .mockResolvedValue(connection as any);

    const transport = createTransport({
      reconnect: {
        enabled: false,
      },
    });

    await transport.init();
    await expect(
      (transport as any).ensureRecoveredAndResumed("forced-test"),
    ).rejects.toThrow("transport not initialized");
  });

  it("logs nack-settlement failures", () => {
    const loggerError = jest.fn();
    const transport = createTransport({
      logger: { error: loggerError },
    });

    const failingChannel = {
      nack: () => {
        throw "nack-failed";
      },
    };
    const message = { content: Buffer.from("hello") };

    (transport as any).settleWithNack(failingChannel, message, true);

    expect(loggerError).toHaveBeenCalledWith(
      "RabbitMQ transport failed to nack message.",
      expect.objectContaining({
        requeue: true,
        error: expect.any(Error),
      }),
    );
  });

  it("swallows close failures during dispose", async () => {
    const channel = createChannelMock({
      close: jest.fn().mockRejectedValue(new Error("channel-close-failed")),
    });
    const connection = createConnectionMock(channel, {
      close: jest.fn().mockRejectedValue(new Error("conn-close-failed")),
    });
    jest
      .spyOn(amqplibModule, "connectAmqplib")
      .mockResolvedValue(connection as any);

    const transport = createTransport();

    await transport.init();
    await expect(transport.dispose()).resolves.toBeUndefined();
  });
});
