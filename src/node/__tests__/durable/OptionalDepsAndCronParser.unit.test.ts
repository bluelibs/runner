import { RedisEventBus } from "../../durable/bus/RedisEventBus";
import type * as IoredisMod from "../../durable/optionalDeps/ioredis";
import type * as AmqplibMod from "../../durable/optionalDeps/amqplib";
import type * as CronParserMod from "../../durable/core/CronParser";

describe("durable: optional deps helpers", () => {
  it("createIORedisClient() throws when ioredis is missing", () => {
    jest.resetModules();
    jest.isolateModules(() => {
      jest.doMock(
        "ioredis",
        () => {
          throw new Error("Cannot find module 'ioredis'");
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
        throw new Error("Cannot find module 'amqplib'");
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

describe("durable: CronParser", () => {
  type RequireFn = (id: string) => unknown;

  function mockNodeCreateRequire(requireFn: RequireFn): void {
    jest.doMock("node:module", () => {
      const actual = jest.requireActual(
        "node:module",
      ) as typeof import("node:module");

      return {
        ...actual,
        createRequire: () => requireFn,
      };
    });
  }

  it("uses cron-parser when available", () => {
    jest.resetModules();
    jest.isolateModules(() => {
      const parse = jest.fn(() => ({
        next: () => ({
          toDate: () => new Date(1234),
        }),
      }));

      mockNodeCreateRequire((id) => {
        if (id === "cron-parser") return { CronExpressionParser: { parse } };
        throw new Error(`Cannot find module '${id}'`);
      });

      const {
        CronParser,
      }: typeof CronParserMod = require("../../durable/core/CronParser");
      const next = CronParser.getNextRun("*/5 * * * *", new Date());
      expect(next.getTime()).toBe(1234);
      expect(parse).toHaveBeenCalled();
      expect(CronParser.isValid("*/5 * * * *")).toBe(true);
    });
  });

  it("falls back to a basic parser when cron-parser is missing", () => {
    jest.resetModules();
    jest.isolateModules(() => {
      mockNodeCreateRequire((id) => {
        if (id === "cron-parser") {
          throw new Error("Cannot find module 'cron-parser'");
        }
        throw new Error(`Cannot find module '${id}'`);
      });

      const {
        CronParser,
      }: typeof CronParserMod = require("../../durable/core/CronParser");
      const from = new Date(2020, 0, 1, 0, 0, 0);
      const next = CronParser.getNextRun("*/5 * * * *", from);

      expect(next.getTime()).toBeGreaterThan(from.getTime());
      expect(next.getSeconds()).toBe(0);
      expect(next.getMilliseconds()).toBe(0);
      expect(next.getMinutes() % 5).toBe(0);
    });
  });

  it("supports day-of-week 7 (Sunday) in fallback parser", () => {
    jest.resetModules();
    jest.isolateModules(() => {
      mockNodeCreateRequire((id) => {
        if (id === "cron-parser") {
          throw new Error("Cannot find module 'cron-parser'");
        }
        throw new Error(`Cannot find module '${id}'`);
      });

      const {
        CronParser,
      }: typeof CronParserMod = require("../../durable/core/CronParser");
      const saturdayNoon = new Date(2020, 0, 4, 12, 0, 0); // Sat
      const next = CronParser.getNextRun("0 0 * * 7", saturdayNoon);
      expect(next.getDay()).toBe(0);
      expect(next.getHours()).toBe(0);
      expect(next.getMinutes()).toBe(0);
    });
  });

  it("supports explicit day-of-week values in fallback parser", () => {
    jest.resetModules();
    jest.isolateModules(() => {
      mockNodeCreateRequire((id) => {
        if (id === "cron-parser") {
          throw new Error("Cannot find module 'cron-parser'");
        }
        throw new Error(`Cannot find module '${id}'`);
      });

      const {
        CronParser,
      }: typeof CronParserMod = require("../../durable/core/CronParser");
      const fridayNoon = new Date(2020, 0, 3, 12, 0, 0); // Fri
      const next = CronParser.getNextRun("0 0 * * 6", fridayNoon); // Sat
      expect(next.getDay()).toBe(6);
    });
  });

  it("rejects unsupported cron syntax in fallback parser", () => {
    jest.resetModules();
    jest.isolateModules(() => {
      mockNodeCreateRequire((id) => {
        if (id === "cron-parser") {
          throw new Error("Cannot find module 'cron-parser'");
        }
        throw new Error(`Cannot find module '${id}'`);
      });

      const {
        CronParser,
      }: typeof CronParserMod = require("../../durable/core/CronParser");
      expect(CronParser.isValid("1-5 * * * *")).toBe(false);
      expect(CronParser.isValid("*/0 * * * *")).toBe(false);
      expect(CronParser.isValid("not-a-cron")).toBe(false);
      expect(CronParser.isValid("60 * * * *")).toBe(false);
    });
  });

  it("ignores cron-parser modules with unexpected exports", () => {
    jest.resetModules();
    jest.isolateModules(() => {
      mockNodeCreateRequire((id) => {
        if (id === "cron-parser") return 123;
        throw new Error(`Cannot find module '${id}'`);
      });
      const {
        CronParser,
      }: typeof CronParserMod = require("../../durable/core/CronParser");
      const from = new Date(2020, 0, 1, 0, 0, 0);
      const next = CronParser.getNextRun("*/5 * * * *", from);
      expect(next.getTime()).toBeGreaterThan(from.getTime());
    });
  });

  it("ignores cron-parser modules without a parse() function", () => {
    jest.resetModules();
    jest.isolateModules(() => {
      mockNodeCreateRequire((id) => {
        if (id === "cron-parser")
          return { CronExpressionParser: { parse: 123 } };
        throw new Error(`Cannot find module '${id}'`);
      });
      const {
        CronParser,
      }: typeof CronParserMod = require("../../durable/core/CronParser");
      const from = new Date(2020, 0, 1, 0, 0, 0);
      const next = CronParser.getNextRun("*/5 * * * *", from);
      expect(next.getTime()).toBeGreaterThan(from.getTime());
    });
  });

  it("supports step-based day-of-week in fallback parser", () => {
    jest.resetModules();
    jest.isolateModules(() => {
      mockNodeCreateRequire((id) => {
        if (id === "cron-parser") {
          throw new Error("Cannot find module 'cron-parser'");
        }
        throw new Error(`Cannot find module '${id}'`);
      });

      const {
        CronParser,
      }: typeof CronParserMod = require("../../durable/core/CronParser");
      const from = new Date(2020, 0, 1, 0, 0, 0);
      const next = CronParser.getNextRun("0 0 * * */2", from);
      expect(next.getDay() % 2).toBe(0);
    });
  });

  it("throws when fallback cron has no valid matches", () => {
    jest.resetModules();
    jest.isolateModules(() => {
      mockNodeCreateRequire((id) => {
        if (id === "cron-parser") {
          throw new Error("Cannot find module 'cron-parser'");
        }
        throw new Error(`Cannot find module '${id}'`);
      });

      const {
        CronParser,
      }: typeof CronParserMod = require("../../durable/core/CronParser");
      expect(() =>
        CronParser.getNextRun("0 0 31 2 *", new Date(2020, 0, 1)),
      ).toThrow("did not match any time");
    });
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
