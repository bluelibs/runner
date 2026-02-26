import * as amqplibModule from "../../../durable/optionalDeps/amqplib";
import { RabbitMQTransport } from "../../../queue/rabbitmq/RabbitMQTransport";

type ChannelMock = {
  assertQueue: jest.Mock;
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

describe("node: RabbitMQTransport", () => {
  let channelMock: ChannelMock;
  let connMock: ConnectionMock;

  beforeEach(() => {
    channelMock = {
      assertQueue: jest.fn().mockResolvedValue({}),
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("initializes defaults and supports publish/prefetch/dispose", async () => {
    const transport = new RabbitMQTransport<{ id?: string }>({
      queue: { name: "transport.default" },
      parseFailureLogMessage: "parse-failed",
      handlerFailureLogMessage: "handler-failed",
      decode: (content) => JSON.parse(content.toString()) as { id?: string },
      resolveMessageId: (message) => message.id,
      throwNotInitialized: () => {
        throw new Error("transport not initialized");
      },
    });

    await transport.init();
    expect(channelMock.assertQueue).toHaveBeenCalledWith(
      "transport.default",
      expect.objectContaining({
        durable: true,
        arguments: expect.objectContaining({ "x-queue-type": "quorum" }),
      }),
    );
    expect(channelMock.prefetch).toHaveBeenCalledWith(10);

    await transport.publish(Buffer.from('{"id":"a"}'));
    expect(channelMock.sendToQueue).toHaveBeenCalledWith(
      "transport.default",
      expect.any(Buffer),
      expect.objectContaining({ persistent: true }),
    );

    await transport.setPrefetch(5);
    expect(channelMock.prefetch).toHaveBeenLastCalledWith(5);

    await transport.consume(async () => {});
    await transport.dispose();
    expect(channelMock.cancel).toHaveBeenCalledWith("tag");
    expect(channelMock.close).toHaveBeenCalled();
    expect(connMock.close).toHaveBeenCalled();
  });

  it("supports cancelConsumer with and without an active consumer", async () => {
    const transport = new RabbitMQTransport<{ id?: string }>({
      queue: { name: "transport.cancel" },
      parseFailureLogMessage: "parse-failed",
      handlerFailureLogMessage: "handler-failed",
      decode: (content) => JSON.parse(content.toString()) as { id?: string },
      resolveMessageId: (message) => message.id,
      throwNotInitialized: () => {
        throw new Error("transport not initialized");
      },
    });

    await transport.init();
    await transport.cancelConsumer();
    expect(channelMock.cancel).not.toHaveBeenCalled();

    await transport.consume(async () => {});
    await transport.cancelConsumer();
    expect(channelMock.cancel).toHaveBeenCalledWith("tag");
  });

  it("throws from throwNotInitialized before init", async () => {
    const transport = new RabbitMQTransport<{ id?: string }>({
      queue: { name: "transport.not-initialized", quorum: false },
      logger: { error: jest.fn() },
      parseFailureLogMessage: "parse-failed",
      handlerFailureLogMessage: "handler-failed",
      decode: (content) => JSON.parse(content.toString()) as { id?: string },
      resolveMessageId: (message) => message.id,
      throwNotInitialized: () => {
        throw new Error("transport not initialized");
      },
    });

    await expect(transport.publish(Buffer.from("{}"))).rejects.toThrow(
      "transport not initialized",
    );
    await expect(transport.consume(async () => {})).rejects.toThrow(
      "transport not initialized",
    );
  });

  it("nacks null/invalid/unresolvable messages and defaults nack requeue", async () => {
    const loggerError = jest.fn();
    const transport = new RabbitMQTransport<{ id?: string; mode?: string }>({
      queue: { name: "transport.consume" },
      logger: { error: loggerError },
      parseFailureLogMessage: "parse-failed",
      handlerFailureLogMessage: "handler-failed",
      decode: (content) => {
        const text = content.toString();
        if (text === "null-payload") {
          return null;
        }
        return JSON.parse(text) as { id?: string; mode?: string };
      },
      resolveMessageId: (message) => message.id,
      throwNotInitialized: () => {
        throw new Error("transport not initialized");
      },
    });

    await transport.init();
    let consumer:
      | ((msg: { content: Buffer } | null) => Promise<void>)
      | undefined;
    channelMock.consume.mockImplementation(
      async (_queue: string, handler: any) => {
        consumer = handler;
      },
    );

    await transport.consume(async (message) => {
      if (message.mode === "handler-fail") {
        throw "primitive-handler-error";
      }
    });

    await consumer?.(null);
    await consumer?.({ content: Buffer.from("{bad-json}") });
    await consumer?.({ content: Buffer.from("null-payload") });
    await consumer?.({
      content: Buffer.from(JSON.stringify({ mode: "no-id" })),
    });

    const routed = { content: Buffer.from(JSON.stringify({ id: "route-1" })) };
    await consumer?.(routed);
    await transport.nack("route-1");
    expect(channelMock.nack).toHaveBeenCalledWith(routed, false, true);

    await transport.ack("missing-id");
    await transport.nack("missing-id");

    await consumer?.({
      content: Buffer.from(
        JSON.stringify({ id: "route-2", mode: "handler-fail" }),
      ),
    });
    expect(loggerError).toHaveBeenCalledWith(
      "parse-failed",
      expect.objectContaining({ error: expect.any(Error) }),
    );
    expect(loggerError).toHaveBeenCalledWith(
      "handler-failed",
      expect.objectContaining({
        error: expect.any(Error),
        messageId: "route-2",
      }),
    );
  });
});
