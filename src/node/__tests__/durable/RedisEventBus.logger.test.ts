import { createMessageError } from "../../../errors";
import type { ILog } from "../../../models/Logger";
import { Logger } from "../../../models/Logger";
import { Serializer } from "../../../serializer";
import { RedisEventBus } from "../../durable/bus/RedisEventBus";
import * as ioredisOptional from "../../durable/optionalDeps/ioredis";

describe("durable: RedisEventBus logger", () => {
  let redisMock: any;
  let onMessage: ((chan: string, msg: string) => void) | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    onMessage = undefined;
    redisMock = {
      publish: jest.fn().mockResolvedValue(1),
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(1),
      on: jest.fn().mockImplementation((evt: string, fn: any) => {
        if (evt === "message") onMessage = fn;
      }),
      quit: jest.fn().mockResolvedValue("OK"),
      duplicate: jest.fn().mockReturnThis(),
    };
    jest
      .spyOn(ioredisOptional, "createIORedisClient")
      .mockReturnValue(redisMock as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createSilentLogger(logs: ILog[]): Logger {
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    logger.onLog((log) => {
      logs.push(log);
    });
    return logger;
  }

  it("logs handler errors through logger when callback is absent", async () => {
    const logs: ILog[] = [];
    const logger = createSilentLogger(logs);
    const bus = new RedisEventBus({ redis: redisMock, logger });
    const serializer = new Serializer();

    await bus.subscribe("chan", async () => {
      throw createMessageError("handler-failed");
    });

    onMessage?.(
      "durable:bus:chan",
      serializer.stringify({ type: "t", payload: {}, timestamp: new Date() }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          message: "RedisEventBus handler failed.",
        }),
      ]),
    );
  });

  it("logs callback failures when onHandlerError throws", async () => {
    const logs: ILog[] = [];
    const logger = createSilentLogger(logs);
    const bus = new RedisEventBus({
      redis: redisMock,
      logger,
      onHandlerError: async () => {
        throw createMessageError("callback-failed");
      },
    });
    const serializer = new Serializer();

    await bus.subscribe("chan", async () => {
      throw createMessageError("handler-failed");
    });

    onMessage?.(
      "durable:bus:chan",
      serializer.stringify({ type: "t", payload: {}, timestamp: new Date() }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          message: "RedisEventBus error callback failed.",
        }),
      ]),
    );
  });

  it("supports constructor default config when called with no args", async () => {
    const bus = new RedisEventBus();
    await bus.publish("chan", {
      type: "t",
      payload: {},
      timestamp: new Date(),
    });

    expect(ioredisOptional.createIORedisClient).toHaveBeenCalledWith(undefined);
  });
});
