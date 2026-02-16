import { RedisEventBus } from "../../durable/bus/RedisEventBus";
import { Serializer } from "../../../serializer";
import * as ioredisOptional from "../../durable/optionalDeps/ioredis";

describe("durable: RedisEventBus", () => {
  let redisMock: any;
  let bus: RedisEventBus;
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
    bus = new RedisEventBus({ redis: redisMock });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("publishes events", async () => {
    await bus.publish("chan", {
      type: "t",
      payload: {},
      timestamp: new Date(),
    });
    expect(redisMock.publish).toHaveBeenCalledWith(
      "durable:bus:chan",
      expect.any(String),
    );
  });

  it("subscribes and handles incoming messages", async () => {
    const serializer = new Serializer();

    let received: { ok: boolean; timestampIsDate: boolean } | null = null;
    await bus.subscribe("chan", async (evt) => {
      received = { ok: true, timestampIsDate: evt.timestamp instanceof Date };
    });

    expect(redisMock.subscribe).toHaveBeenCalledWith("durable:bus:chan");
    expect(redisMock.on).toHaveBeenCalledWith("message", expect.any(Function));

    const event = { type: "t", payload: {}, timestamp: new Date() };
    onMessage?.("durable:bus:chan", serializer.stringify(event));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toEqual({ ok: true, timestampIsDate: true });
  });

  it("logs handler errors instead of throwing", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const serializer = new Serializer();

    try {
      await bus.subscribe("chan", async () => {
        throw new Error("boom");
      });

      const event = { type: "t", payload: {}, timestamp: new Date() };
      onMessage?.("durable:bus:chan", serializer.stringify(event));

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(spy).toHaveBeenCalledWith(expect.any(Error));
    } finally {
      spy.mockRestore();
    }
  });

  it("logs synchronous handler errors instead of throwing", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const serializer = new Serializer();

    try {
      await bus.subscribe("chan", () => {
        throw new Error("sync-boom");
      });

      const event = { type: "t", payload: {}, timestamp: new Date() };
      expect(() =>
        onMessage?.("durable:bus:chan", serializer.stringify(event)),
      ).not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(spy).toHaveBeenCalledWith(expect.any(Error));
    } finally {
      spy.mockRestore();
    }
  });

  it("supports tree-encoded Date timestamps (Serializer path)", async () => {
    let received: Date | undefined;
    await bus.subscribe("chan", async (evt) => {
      received = evt.timestamp;
    });

    const message = JSON.stringify({
      type: "t",
      payload: {},
      timestamp: {
        __type: "Date",
        value: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    onMessage?.("durable:bus:chan", message);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toBeInstanceOf(Date);
    expect(received?.toISOString()).toBe("2020-01-01T00:00:00.000Z");
  });

  it("coerces legacy JSON timestamp strings and numbers into Date", async () => {
    const timestamps: Date[] = [];
    await bus.subscribe("chan", async (evt) => {
      timestamps.push(evt.timestamp);
    });

    onMessage?.(
      "durable:bus:chan",
      JSON.stringify({
        type: "t",
        payload: {},
        timestamp: "2020-01-01T00:00:00.000Z",
      }),
    );
    onMessage?.(
      "durable:bus:chan",
      JSON.stringify({ type: "t", payload: {}, timestamp: 0 }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(timestamps).toHaveLength(2);
    expect(timestamps[0].toISOString()).toBe("2020-01-01T00:00:00.000Z");
    expect(timestamps[1].toISOString()).toBe("1970-01-01T00:00:00.000Z");
  });

  it("ignores messages that fail Serializer deserialization (ex: unknown types)", async () => {
    const handler = jest.fn(async () => {});
    await bus.subscribe("chan", handler);

    // Serializer.deserialize throws Unknown type; legacy JSON.parse still returns an object,
    // but timestamp is not coercible -> message is ignored.
    onMessage?.(
      "durable:bus:chan",
      JSON.stringify({
        type: "t",
        payload: {},
        timestamp: { __type: "__unknown__", value: "x" },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores messages for other channels and after unsubscribe", async () => {
    const serializer = new Serializer();

    await bus.subscribe("chan", async () => {});

    const event = { type: "t", payload: {}, timestamp: new Date() };
    onMessage?.("durable:bus:other", serializer.stringify(event));

    await bus.unsubscribe("chan");
    onMessage?.("durable:bus:chan", serializer.stringify(event));
  });

  it("ignores non-events and invalid timestamps without invoking handlers", async () => {
    const handler = jest.fn(async () => {});
    await bus.subscribe("chan", handler);

    // Not a BusEvent -> falls back to legacy JSON.parse path and still ignored
    onMessage?.("durable:bus:chan", "{}");

    // Not an object -> ignored
    onMessage?.("durable:bus:chan", "null");

    // Invalid type -> ignored
    onMessage?.(
      "durable:bus:chan",
      JSON.stringify({
        type: 123,
        payload: {},
        timestamp: new Date().toISOString(),
      }),
    );

    // Invalid JSON -> both parses fail and message is ignored
    onMessage?.("durable:bus:chan", "{not-json");

    // Invalid timestamp -> parsed but rejected by timestamp coercion
    onMessage?.(
      "durable:bus:chan",
      JSON.stringify({ type: "t", payload: {}, timestamp: "not-a-date" }),
    );
    onMessage?.(
      "durable:bus:chan",
      JSON.stringify({ type: "t", payload: {}, timestamp: {} }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handler).not.toHaveBeenCalled();
  });

  it("unsubscribes and disposes", async () => {
    await bus.subscribe("chan", async () => {});
    await bus.unsubscribe("chan");
    expect(redisMock.unsubscribe).toHaveBeenCalledWith("durable:bus:chan");

    await bus.dispose?.();
    expect(redisMock.quit).toHaveBeenCalled();
  });

  it("unsubscribe(channel, handler) only removes that handler until last one", async () => {
    const handlerA = jest.fn(async () => {});
    const handlerB = jest.fn(async () => {});
    await bus.subscribe("chan", handlerA);
    await bus.subscribe("chan", handlerB);

    await bus.unsubscribe("chan", handlerA);
    expect(redisMock.unsubscribe).not.toHaveBeenCalled();

    await bus.unsubscribe("chan", handlerB);
    expect(redisMock.unsubscribe).toHaveBeenCalledWith("durable:bus:chan");
  });

  it("unsubscribe is a no-op for unknown channels", async () => {
    await expect(bus.unsubscribe("missing")).resolves.toBeUndefined();
  });

  it("supports string redis url and default redis in constructor", async () => {
    (
      ioredisOptional.createIORedisClient as unknown as jest.Mock
    ).mockReturnValue(redisMock);

    const busFromUrl = new RedisEventBus({ redis: "redis://localhost:6379" });
    await busFromUrl.publish("chan", {
      type: "t",
      payload: {},
      timestamp: new Date(),
    });

    const busDefault = new RedisEventBus({});
    await busDefault.publish("chan", {
      type: "t",
      payload: {},
      timestamp: new Date(),
    });

    expect(ioredisOptional.createIORedisClient).toHaveBeenCalledWith(
      "redis://localhost:6379",
    );
    expect(ioredisOptional.createIORedisClient).toHaveBeenCalledWith(undefined);
  });
});
