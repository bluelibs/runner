import { RedisEventBus } from "../../durable/bus/RedisEventBus";
import type * as IoredisMod from "../../durable/optionalDeps/ioredis";
import type * as AmqplibMod from "../../durable/optionalDeps/amqplib";
import { createMessageError } from "../../../errors";

describe("durable: optional deps helpers", () => {
  it("createIORedisClient() throws when ioredis is missing", () => {
    jest.resetModules();
    jest.isolateModules(() => {
      jest.doMock(
        "ioredis",
        () => {
          throw createMessageError("Cannot find module 'ioredis'");
        },
        { virtual: true },
      );

      const {
        createIORedisClient,
      }: typeof IoredisMod = require("../../durable/optionalDeps/ioredis");
      expect(() => createIORedisClient()).toThrow(
        "Missing optional dependency 'ioredis'",
      );
    });
  });

  it("createIORedisClient() handles non-Error throws", () => {
    jest.resetModules();
    jest.isolateModules(() => {
      jest.doMock(
        "ioredis",
        () => {
          throw "boom";
        },
        { virtual: true },
      );

      const {
        createIORedisClient,
      }: typeof IoredisMod = require("../../durable/optionalDeps/ioredis");
      expect(() => createIORedisClient()).toThrow(
        "Missing optional dependency 'ioredis'",
      );
    });
  });

  it("createIORedisClient() supports default exports", () => {
    jest.resetModules();
    jest.isolateModules(() => {
      const ctor = jest.fn().mockImplementation(function Redis(
        this: any,
        url?: string,
      ) {
        this.url = url ?? null;
      });

      jest.doMock(
        "ioredis",
        () => ({
          __esModule: true,
          default: ctor,
        }),
        { virtual: true },
      );

      const {
        createIORedisClient,
      }: typeof IoredisMod = require("../../durable/optionalDeps/ioredis");
      const client1 = createIORedisClient("redis://localhost");
      const client2 = createIORedisClient();
      expect(client1).toEqual(
        expect.objectContaining({ url: "redis://localhost" }),
      );
      expect(client2).toEqual(expect.objectContaining({ url: null }));
      expect(ctor).toHaveBeenCalledTimes(2);
    });
  });

  it("createIORedisClient() supports function exports", () => {
    jest.resetModules();
    jest.isolateModules(() => {
      const ctor = jest.fn().mockImplementation(function Redis(
        this: any,
        url?: string,
      ) {
        this.url = url ?? "default";
      });
      jest.doMock("ioredis", () => ctor, { virtual: true });

      const {
        createIORedisClient,
      }: typeof IoredisMod = require("../../durable/optionalDeps/ioredis");
      const client1 = createIORedisClient();
      const client2 = createIORedisClient("redis://x");
      expect(client1).toEqual(expect.objectContaining({ url: "default" }));
      expect(client2).toEqual(expect.objectContaining({ url: "redis://x" }));
      expect(ctor).toHaveBeenCalledTimes(2);
    });
  });

  it("createIORedisClient() rejects invalid ioredis exports", () => {
    jest.resetModules();
    jest.isolateModules(() => {
      jest.doMock("ioredis", () => ({ __esModule: true, default: {} }), {
        virtual: true,
      });

      const {
        createIORedisClient,
      }: typeof IoredisMod = require("../../durable/optionalDeps/ioredis");
      expect(() => createIORedisClient()).toThrow(
        "Missing optional dependency 'ioredis'",
      );
    });
  });

  it("connectAmqplib() throws when amqplib is missing", async () => {
    jest.resetModules();
    jest.doMock(
      "amqplib",
      () => {
        throw createMessageError("Cannot find module 'amqplib'");
      },
      { virtual: true },
    );

    let connectAmqplib!: typeof AmqplibMod.connectAmqplib;
    jest.isolateModules(() => {
      ({ connectAmqplib } = require("../../durable/optionalDeps/amqplib"));
    });

    await expect(connectAmqplib("amqp://localhost")).rejects.toThrow(
      "Missing optional dependency 'amqplib'",
    );
  });

  it("connectAmqplib() handles non-Error throws", async () => {
    jest.resetModules();
    jest.doMock(
      "amqplib",
      () => {
        throw "boom";
      },
      { virtual: true },
    );

    let connectAmqplib!: typeof AmqplibMod.connectAmqplib;
    jest.isolateModules(() => {
      ({ connectAmqplib } = require("../../durable/optionalDeps/amqplib"));
    });

    await expect(connectAmqplib("amqp://localhost")).rejects.toThrow(
      "Missing optional dependency 'amqplib'",
    );
  });

  it("connectAmqplib() delegates to amqplib.connect", async () => {
    jest.resetModules();
    const connect = jest.fn().mockResolvedValue({ ok: true });
    jest.doMock("amqplib", () => ({ connect }), { virtual: true });

    let connectAmqplib!: typeof AmqplibMod.connectAmqplib;
    jest.isolateModules(() => {
      ({ connectAmqplib } = require("../../durable/optionalDeps/amqplib"));
    });

    await expect(connectAmqplib("amqp://localhost")).resolves.toEqual({
      ok: true,
    });
    await expect(connectAmqplib("amqp://localhost")).resolves.toEqual({
      ok: true,
    });
    expect(connect).toHaveBeenCalledWith("amqp://localhost");
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("connectAmqplib() rejects invalid amqplib exports", async () => {
    jest.resetModules();
    jest.doMock("amqplib", () => 123, { virtual: true });

    let connectAmqplib!: typeof AmqplibMod.connectAmqplib;
    jest.isolateModules(() => {
      ({ connectAmqplib } = require("../../durable/optionalDeps/amqplib"));
    });

    await expect(connectAmqplib("amqp://localhost")).rejects.toThrow(
      "Missing optional dependency 'amqplib'",
    );
  });

  it("connectAmqplib() rejects non-function connect exports", async () => {
    jest.resetModules();
    jest.doMock("amqplib", () => ({ connect: 123 }), { virtual: true });

    let connectAmqplib!: typeof AmqplibMod.connectAmqplib;
    jest.isolateModules(() => {
      ({ connectAmqplib } = require("../../durable/optionalDeps/amqplib"));
    });

    await expect(connectAmqplib("amqp://localhost")).rejects.toThrow(
      "Missing optional dependency 'amqplib'",
    );
  });
});

describe("durable: RedisEventBus validation", () => {
  it("throws when redis client does not support duplicate()", () => {
    const clientWithoutDuplicate = {
      publish: async () => 1,
      subscribe: async () => 1,
      unsubscribe: async () => 1,
      on: () => undefined,
      quit: async () => "OK",
    } as any;

    expect(() => new RedisEventBus({ redis: clientWithoutDuplicate })).toThrow(
      "duplicate()",
    );
  });
});
