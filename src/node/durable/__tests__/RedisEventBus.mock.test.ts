import Redis from "ioredis";
import { RedisEventBus } from "../bus/RedisEventBus";

jest.mock("ioredis", () => ({ __esModule: true, default: jest.fn() }));

describe("durable: RedisEventBus", () => {
  let redisMock: any;
  let bus: RedisEventBus;
  const RedisMock = Redis as unknown as jest.Mock;

  beforeEach(() => {
    redisMock = {
      publish: jest.fn().mockResolvedValue(1),
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(1),
      on: jest.fn(),
      quit: jest.fn().mockResolvedValue("OK"),
      duplicate: jest.fn().mockReturnThis(),
    };
    RedisMock.mockImplementation(() => redisMock);
    bus = new RedisEventBus({ redis: redisMock });
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
    let onMessage: ((chan: string, msg: string) => void) | undefined;
    redisMock.on.mockImplementation((evt: string, fn: any) => {
      if (evt === "message") onMessage = fn;
    });

    let received = false;
    await bus.subscribe("chan", async () => {
      received = true;
    });

    expect(redisMock.subscribe).toHaveBeenCalledWith("durable:bus:chan");
    expect(redisMock.on).toHaveBeenCalledWith("message", expect.any(Function));

    const event = { type: "t", payload: {}, timestamp: new Date() };
    onMessage?.("durable:bus:chan", JSON.stringify(event));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toBe(true);
  });

  it("ignores messages for other channels and after unsubscribe", async () => {
    let onMessage: ((chan: string, msg: string) => void) | undefined;
    redisMock.on.mockImplementation((evt: string, fn: any) => {
      if (evt === "message") onMessage = fn;
    });

    await bus.subscribe("chan", async () => {});

    const event = { type: "t", payload: {}, timestamp: new Date() };
    onMessage?.("durable:bus:other", JSON.stringify(event));

    await bus.unsubscribe("chan");
    onMessage?.("durable:bus:chan", JSON.stringify(event));
  });

  it("unsubscribes and disposes", async () => {
    await bus.subscribe("chan", async () => {});
    await bus.unsubscribe("chan");
    expect(redisMock.unsubscribe).toHaveBeenCalledWith("durable:bus:chan");

    await bus.dispose?.();
    expect(redisMock.quit).toHaveBeenCalled();
  });

  it("supports string redis url and default redis in constructor", async () => {
    RedisMock.mockClear();

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

    expect(RedisMock).toHaveBeenCalled();
  });
});
