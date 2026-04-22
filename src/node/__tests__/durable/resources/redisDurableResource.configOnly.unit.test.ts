import { resources, Serializer } from "../../../../index";
import { RunnerMode } from "../../../../types/runner";
import type { DurableResource } from "../../../durable/core/DurableResource";

type CreateRunnerDurableRuntime =
  typeof import("../../../durable/core/createRunnerDurableRuntime").createRunnerDurableRuntime;
type DisposeDurableService =
  typeof import("../../../durable/core/DurableService").disposeDurableService;

describe("durable: redisDurableResource (config-only)", () => {
  const deps = {
    taskRunner: {} as any,
    eventManager: {} as any,
    runnerStore: { tasks: new Map() } as any,
  };

  beforeEach(() => {
    jest.resetModules();
  });

  function mockCreateRunnerDurableRuntime() {
    const fakeDurable = { service: {} } as unknown as DurableResource;
    const createRunnerDurableRuntime = jest.fn<
      ReturnType<CreateRunnerDurableRuntime>,
      Parameters<CreateRunnerDurableRuntime>
    >(async (_config, _deps) => fakeDurable);

    return { createRunnerDurableRuntime, fakeDurable };
  }

  function mockDisposeDurableService() {
    const disposeDurableService = jest.fn<
      ReturnType<DisposeDurableService>,
      Parameters<DisposeDurableService>
    >(async (_service, _config) => {});

    return { disposeDurableService };
  }

  it("derives prefixes and queue names from resource id by default", async () => {
    class RedisStoreMock {
      constructor(public readonly cfg: unknown) {}
    }
    class RedisEventBusMock {
      constructor(public readonly cfg: unknown) {}
    }
    class RabbitMQQueueMock {
      constructor(public readonly cfg: unknown) {}
    }

    const { createRunnerDurableRuntime, fakeDurable } =
      mockCreateRunnerDurableRuntime();
    const { disposeDurableService } = mockDisposeDurableService();

    jest.doMock("../../../durable/store/RedisStore", () => ({
      RedisStore: RedisStoreMock,
    }));
    jest.doMock("../../../durable/bus/RedisEventBus", () => ({
      RedisEventBus: RedisEventBusMock,
    }));
    jest.doMock("../../../durable/queue/RabbitMQQueue", () => ({
      RabbitMQQueue: RabbitMQQueueMock,
    }));
    jest.doMock("../../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../../durable/core/DurableService", () => ({
      disposeDurableService,
    }));

    let redisDurableResource!: typeof import("../../../durable/resources/redisDurableResource").redisDurableResource;
    jest.isolateModules(() => {
      ({
        redisDurableResource,
      } = require("../../../durable/resources/redisDurableResource"));
    });

    expect(redisDurableResource.context?.()).toEqual({ runtimeConfig: null });

    const ctx = { runtimeConfig: null as any };
    const durable = await redisDurableResource.init!.call(
      { id: "tenant A/1" },
      { redis: { url: "redis://x" }, queue: { url: "amqp://y" } },
      deps as any,
      ctx as any,
    );

    expect(durable).toBe(fakeDurable);

    const runtimeConfig = createRunnerDurableRuntime.mock.calls[0]?.[0];

    expect((runtimeConfig?.store as any).cfg).toEqual(
      expect.objectContaining({ prefix: "durable:tenant%20A%2F1:" }),
    );
    expect((runtimeConfig?.eventBus as any).cfg).toEqual(
      expect.objectContaining({ prefix: "durable:bus:tenant%20A%2F1:" }),
    );
    expect((runtimeConfig?.queue as any).cfg).toEqual(
      expect.objectContaining({
        queue: expect.objectContaining({
          name: "durable_executions:tenant%20A%2F1",
          deadLetter: "durable_executions:dlq:tenant%20A%2F1",
        }),
      }),
    );
    expect(runtimeConfig?.roles).toEqual({
      queueConsumer: false,
    });

    await redisDurableResource.dispose!(
      durable,
      {} as any,
      {} as any,
      ctx as any,
    );
    expect(disposeDurableService).toHaveBeenCalledWith(
      (durable as any).service,
      runtimeConfig,
    );
  });

  it("starts an embedded worker only when queue.consume=true", async () => {
    class RedisStoreMock {
      constructor(public readonly cfg: unknown) {}
    }
    class RedisEventBusMock {
      constructor(public readonly cfg: unknown) {}
    }
    class RabbitMQQueueMock {
      constructor(public readonly cfg: unknown) {}
    }

    const { createRunnerDurableRuntime, fakeDurable } =
      mockCreateRunnerDurableRuntime();

    jest.doMock("../../../durable/store/RedisStore", () => ({
      RedisStore: RedisStoreMock,
    }));
    jest.doMock("../../../durable/bus/RedisEventBus", () => ({
      RedisEventBus: RedisEventBusMock,
    }));
    jest.doMock("../../../durable/queue/RabbitMQQueue", () => ({
      RabbitMQQueue: RabbitMQQueueMock,
    }));
    jest.doMock("../../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../../durable/core/DurableService", () => ({
      disposeDurableService: jest.fn(async () => {}),
    }));

    let redisDurableResource!: typeof import("../../../durable/resources/redisDurableResource").redisDurableResource;
    jest.isolateModules(() => {
      ({
        redisDurableResource,
      } = require("../../../durable/resources/redisDurableResource"));
    });

    const durable = await redisDurableResource.init!.call(
      { id: "tenantA-durable" },
      {
        redis: { url: "redis://x" },
        queue: { url: "amqp://y", consume: true },
      },
      deps as any,
      { runtimeConfig: null } as any,
    );

    expect(durable).toBe(fakeDurable);
    const runtimeConfig = createRunnerDurableRuntime.mock.calls[0]?.[0];
    expect(runtimeConfig?.roles).toEqual({
      queueConsumer: true,
    });
  });

  it("defaults to no queue when no queue is configured", async () => {
    class RedisStoreMock {
      constructor(public readonly cfg: unknown) {}
    }
    class RedisEventBusMock {
      constructor(public readonly cfg: unknown) {}
    }

    const { createRunnerDurableRuntime } = mockCreateRunnerDurableRuntime();

    jest.doMock("../../../durable/store/RedisStore", () => ({
      RedisStore: RedisStoreMock,
    }));
    jest.doMock("../../../durable/bus/RedisEventBus", () => ({
      RedisEventBus: RedisEventBusMock,
    }));
    jest.doMock("../../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../../durable/core/DurableService", () => ({
      disposeDurableService: jest.fn(async () => {}),
    }));

    let redisDurableResource!: typeof import("../../../durable/resources/redisDurableResource").redisDurableResource;
    jest.isolateModules(() => {
      ({
        redisDurableResource,
      } = require("../../../durable/resources/redisDurableResource"));
    });

    await redisDurableResource.init!.call(
      { id: "tenantA-durable" },
      { redis: { url: "redis://x" } },
      deps as any,
      { runtimeConfig: null } as any,
    );

    const runtimeConfig = createRunnerDurableRuntime.mock.calls[0]?.[0];
    expect(runtimeConfig?.queue).toBeUndefined();
  });

  it("defaults serializer dependency selection to resources.serializer", () => {
    let redisDurableResource!: typeof import("../../../durable/resources/redisDurableResource").redisDurableResource;
    jest.isolateModules(() => {
      ({
        redisDurableResource,
      } = require("../../../durable/resources/redisDurableResource"));
    });

    const dependencies =
      typeof redisDurableResource.dependencies === "function"
        ? redisDurableResource.dependencies(
            { redis: { url: "redis://x" } },
            RunnerMode.TEST,
          )
        : redisDurableResource.dependencies;

    expect((dependencies as any).serializer.id).toBe(resources.serializer.id);
  });

  it("uses a custom serializer resource for redis store and bus when configured", async () => {
    class RedisStoreMock {
      constructor(public readonly cfg: unknown) {}
    }
    class RedisEventBusMock {
      constructor(public readonly cfg: unknown) {}
    }

    const { createRunnerDurableRuntime } = mockCreateRunnerDurableRuntime();
    const customSerializerResource = resources.serializer.fork(
      "tests-durable-redis-serializer",
    );
    const customSerializer = new Serializer({ pretty: true });

    jest.doMock("../../../durable/store/RedisStore", () => ({
      RedisStore: RedisStoreMock,
    }));
    jest.doMock("../../../durable/bus/RedisEventBus", () => ({
      RedisEventBus: RedisEventBusMock,
    }));
    jest.doMock("../../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../../durable/core/DurableService", () => ({
      disposeDurableService: jest.fn(async () => {}),
    }));

    let redisDurableResource!: typeof import("../../../durable/resources/redisDurableResource").redisDurableResource;
    jest.isolateModules(() => {
      ({
        redisDurableResource,
      } = require("../../../durable/resources/redisDurableResource"));
    });

    const dependencies =
      typeof redisDurableResource.dependencies === "function"
        ? redisDurableResource.dependencies(
            {
              redis: { url: "redis://x" },
              serializer: customSerializerResource,
            },
            RunnerMode.TEST,
          )
        : redisDurableResource.dependencies;

    expect((dependencies as any).serializer).toBe(customSerializerResource);

    await redisDurableResource.init!.call(
      { id: "tenantA-durable" },
      {
        redis: { url: "redis://x" },
        serializer: customSerializerResource,
      },
      {
        ...deps,
        serializer: customSerializer,
      } as any,
      { runtimeConfig: null } as any,
    );

    const runtimeConfig = createRunnerDurableRuntime.mock.calls[0]?.[0];
    expect("serializer" in (runtimeConfig as object)).toBe(false);
    expect((runtimeConfig?.store as any).cfg).toEqual(
      expect.objectContaining({
        serializer: customSerializer,
      }),
    );
    expect((runtimeConfig?.eventBus as any).cfg).toEqual(
      expect.objectContaining({
        serializer: customSerializer,
      }),
    );
  });

  it("allows queue.enabled=false to disable queue creation explicitly", async () => {
    class RedisStoreMock {
      constructor(public readonly cfg: unknown) {}
    }
    class RedisEventBusMock {
      constructor(public readonly cfg: unknown) {}
    }

    const { createRunnerDurableRuntime } = mockCreateRunnerDurableRuntime();

    jest.doMock("../../../durable/store/RedisStore", () => ({
      RedisStore: RedisStoreMock,
    }));
    jest.doMock("../../../durable/bus/RedisEventBus", () => ({
      RedisEventBus: RedisEventBusMock,
    }));
    jest.doMock("../../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../../durable/core/DurableService", () => ({
      disposeDurableService: jest.fn(async () => {}),
    }));

    let redisDurableResource!: typeof import("../../../durable/resources/redisDurableResource").redisDurableResource;
    jest.isolateModules(() => {
      ({
        redisDurableResource,
      } = require("../../../durable/resources/redisDurableResource"));
    });

    await redisDurableResource.init!.call(
      { id: "tenantA-durable" },
      {
        redis: { url: "redis://x" },
        queue: { url: "amqp://y", enabled: false, consume: true },
      },
      deps as any,
      { runtimeConfig: null } as any,
    );

    const runtimeConfig = createRunnerDurableRuntime.mock.calls[0]?.[0];
    expect(runtimeConfig?.queue).toBeUndefined();
  });

  it("respects explicit namespace and prefix overrides (with normalization)", async () => {
    class RedisStoreMock {
      constructor(public readonly cfg: unknown) {}
    }
    class RedisEventBusMock {
      constructor(public readonly cfg: unknown) {}
    }

    const { createRunnerDurableRuntime } = mockCreateRunnerDurableRuntime();

    jest.doMock("../../../durable/store/RedisStore", () => ({
      RedisStore: RedisStoreMock,
    }));
    jest.doMock("../../../durable/bus/RedisEventBus", () => ({
      RedisEventBus: RedisEventBusMock,
    }));
    jest.doMock("../../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../../durable/core/DurableService", () => ({
      disposeDurableService: jest.fn(async () => {}),
    }));

    let redisDurableResource!: typeof import("../../../durable/resources/redisDurableResource").redisDurableResource;
    jest.isolateModules(() => {
      ({
        redisDurableResource,
      } = require("../../../durable/resources/redisDurableResource"));
    });

    await redisDurableResource.init!.call(
      { id: "ignored-by-namespace" },
      {
        namespace: "ns",
        redis: { url: "redis://x" },
        store: { prefix: "store" },
        eventBus: { prefix: "bus:" },
      },
      deps as any,
      { runtimeConfig: null } as any,
    );

    const runtimeConfig = createRunnerDurableRuntime.mock.calls[0]?.[0];
    expect((runtimeConfig?.store as any).cfg).toEqual(
      expect.objectContaining({ prefix: "store:" }),
    );
    expect((runtimeConfig?.eventBus as any).cfg).toEqual(
      expect.objectContaining({ prefix: "bus:" }),
    );
  });

  it("dispose is a no-op if init never stored runtimeConfig", async () => {
    const { disposeDurableService } = mockDisposeDurableService();

    jest.doMock("../../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime: jest.fn(async () => ({ service: {} })),
    }));
    jest.doMock("../../../durable/core/DurableService", () => ({
      disposeDurableService,
    }));
    jest.doMock("../../../durable/store/RedisStore", () => ({
      RedisStore: class {
        constructor(public readonly cfg: unknown) {}
      },
    }));
    jest.doMock("../../../durable/bus/RedisEventBus", () => ({
      RedisEventBus: class {
        constructor(public readonly cfg: unknown) {}
      },
    }));

    let redisDurableResource!: typeof import("../../../durable/resources/redisDurableResource").redisDurableResource;
    jest.isolateModules(() => {
      ({
        redisDurableResource,
      } = require("../../../durable/resources/redisDurableResource"));
    });

    await redisDurableResource.dispose!(
      { service: {} } as any,
      {} as any,
      {} as any,
      { runtimeConfig: null } as any,
    );

    expect(disposeDurableService).not.toHaveBeenCalled();
  });

  it("cooldown delegates to durable service when runtimeConfig is available", async () => {
    jest.doMock("../../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime: jest.fn(async () => ({ service: {} })),
    }));
    jest.doMock("../../../durable/core/DurableService", () => ({
      disposeDurableService: jest.fn(async () => {}),
    }));
    jest.doMock("../../../durable/store/RedisStore", () => ({
      RedisStore: class {
        constructor(public readonly cfg: unknown) {}
      },
    }));
    jest.doMock("../../../durable/bus/RedisEventBus", () => ({
      RedisEventBus: class {
        constructor(public readonly cfg: unknown) {}
      },
    }));

    let redisDurableResource!: typeof import("../../../durable/resources/redisDurableResource").redisDurableResource;
    jest.isolateModules(() => {
      ({
        redisDurableResource,
      } = require("../../../durable/resources/redisDurableResource"));
    });

    const cooldown = jest.fn(async () => {});
    await redisDurableResource.cooldown!(
      { service: { cooldown } } as any,
      {} as any,
      {} as any,
      { runtimeConfig: {} } as any,
    );

    expect(cooldown).toHaveBeenCalledTimes(1);
  });

  it("cooldown is a no-op if init never stored runtimeConfig", async () => {
    jest.doMock("../../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime: jest.fn(async () => ({ service: {} })),
    }));
    jest.doMock("../../../durable/core/DurableService", () => ({
      disposeDurableService: jest.fn(async () => {}),
    }));
    jest.doMock("../../../durable/store/RedisStore", () => ({
      RedisStore: class {
        constructor(public readonly cfg: unknown) {}
      },
    }));
    jest.doMock("../../../durable/bus/RedisEventBus", () => ({
      RedisEventBus: class {
        constructor(public readonly cfg: unknown) {}
      },
    }));

    let redisDurableResource!: typeof import("../../../durable/resources/redisDurableResource").redisDurableResource;
    jest.isolateModules(() => {
      ({
        redisDurableResource,
      } = require("../../../durable/resources/redisDurableResource"));
    });

    const cooldown = jest.fn(async () => {});
    await redisDurableResource.cooldown!(
      { service: { cooldown } } as any,
      {} as any,
      {} as any,
      { runtimeConfig: null } as any,
    );

    expect(cooldown).not.toHaveBeenCalled();
  });
});
