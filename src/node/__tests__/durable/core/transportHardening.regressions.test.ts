import { RedisEventBus } from "../../../durable/bus/RedisEventBus";
import { RabbitMQQueue } from "../../../durable/queue/RabbitMQQueue";
import { RabbitMQTransport } from "../../../queue/rabbitmq/RabbitMQTransport";
import { Logger } from "../../../../models/Logger";

const silentLogger = () =>
  new Logger({
    printThreshold: null,
    printStrategy: "pretty",
    bufferLogs: false,
  });

describe("durable: transport and event-bus hardening regressions", () => {
  it("catches RabbitMQ disconnect recovery errors and clears queue attempts on disconnect", async () => {
    const reported: string[] = [];
    let disconnected = false;
    const transport = new RabbitMQTransport({
      url: "amqp://localhost",
      queue: { name: "q-test" },
      reconnect: { enabled: false },
      logger: {
        error: async (msg) => {
          reported.push(String(msg));
        },
      },
      parseFailureLogMessage: "parse",
      handlerFailureLogMessage: "handler",
      decode: () => null,
      resolveMessageId: () => undefined,
      throwNotInitialized: () => {
        throw new Error("not-init");
      },
      onDisconnect: () => {
        disconnected = true;
      },
    });
    (transport as any).activeConsumerHandler = async () => {};
    jest
      .spyOn(transport as any, "ensureRecoveredAndResumed")
      .mockRejectedValueOnce(new Error("broker-down"));
    (transport as any).handleUnexpectedDisconnect(0, "close", new Error("eof"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(disconnected).toBe(true);
    expect(reported).toContain("RabbitMQ transport recovery failed.");

    const queue = new RabbitMQQueue({
      url: "amqp://localhost",
      queue: { name: "q-clear" },
    });
    (queue as any).attemptsByMessageId.set("m1", 2);
    (queue as any).transport.config.onDisconnect?.();
    expect((queue as any).attemptsByMessageId.size).toBe(0);
  });

  it("isolates stale RedisEventBus subscribe failures and quits sub even when pub.quit rejects", async () => {
    let rejectFirst!: (err: Error) => void;
    const subMock = {
      on: jest.fn(),
      subscribe: jest
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((_res, rej) => {
              rejectFirst = rej;
            }),
        )
        .mockResolvedValueOnce(1),
      unsubscribe: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue("OK"),
    };
    const pubMock = {
      duplicate: () => subMock,
      publish: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockRejectedValueOnce(new Error("pub-fail")),
    };
    const bus = new RedisEventBus({
      redis: pubMock as never,
      disposeProvidedClient: true,
      logger: silentLogger(),
    });
    const pSub1 = bus.subscribe("ch", async () => {}).catch(() => "failed");
    await Promise.resolve();
    (bus as any).channels.delete("durable:bus:ch");
    await bus.subscribe("ch", async () => {});
    rejectFirst(new Error("stale-sub-err"));
    await pSub1;
    expect((bus as any).channels.has("durable:bus:ch")).toBe(true);
    await expect(bus.dispose()).rejects.toThrow("pub-fail");
    expect(subMock.quit).toHaveBeenCalledTimes(1);
  });
});
