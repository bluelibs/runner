import type { DurableResource } from "../../durable/core/DurableResource";

type CreateRunnerDurableRuntime =
  typeof import("../../durable/core/createRunnerDurableRuntime").createRunnerDurableRuntime;
type DisposeDurableService =
  typeof import("../../durable/core/DurableService").disposeDurableService;

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

    jest.doMock("../../durable/store/RedisStore", () => ({
      RedisStore: RedisStoreMock,
    }));
    jest.doMock("../../durable/bus/RedisEventBus", () => ({
      RedisEventBus: RedisEventBusMock,
    }));
    jest.doMock("../../durable/queue/RabbitMQQueue", () => ({
      RabbitMQQueue: RabbitMQQueueMock,
    }));
    jest.doMock("../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../durable/core/DurableService", () => ({
      disposeDurableService,
    }));

    let redisDurableResource!: typeof import("../../durable/resources/redisDurableResource").redisDurableResource;
    jest.isolateModules(() => {
      ({
        redisDurableResource,
      } = require("../../durable/resources/redisDurableResource"));
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
    expect(runtimeConfig?.worker).toBe(true);

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

  it("defaults to worker=false when no queue is configured", async () => {
    class RedisStoreMock {
      constructor(public readonly cfg: unknown) {}
    }
    class RedisEventBusMock {
      constructor(public readonly cfg: unknown) {}
    }

    const { createRunnerDurableRuntime } = mockCreateRunnerDurableRuntime();

    jest.doMock("../../durable/store/RedisStore", () => ({
      RedisStore: RedisStoreMock,
    }));
    jest.doMock("../../durable/bus/RedisEventBus", () => ({
      RedisEventBus: RedisEventBusMock,
    }));
    jest.doMock("../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../durable/core/DurableService", () => ({
      disposeDurableService: jest.fn(async () => {}),
    }));

    let redisDurableResource!: typeof import("../../durable/resources/redisDurableResource").redisDurableResource;
    jest.isolateModules(() => {
      ({
        redisDurableResource,
      } = require("../../durable/resources/redisDurableResource"));
    });

    await redisDurableResource.init!.call(
      { id: "tenantA.durable" },
      { redis: { url: "redis://x" } },
      deps as any,
      { runtimeConfig: null } as any,
    );

    const runtimeConfig = createRunnerDurableRuntime.mock.calls[0]?.[0];
    expect(runtimeConfig?.queue).toBeUndefined();
    expect(runtimeConfig?.worker).toBe(false);
  });

  it("respects explicit namespace and prefix overrides (with normalization)", async () => {
    class RedisStoreMock {
      constructor(public readonly cfg: unknown) {}
    }
    class RedisEventBusMock {
      constructor(public readonly cfg: unknown) {}
    }

    const { createRunnerDurableRuntime } = mockCreateRunnerDurableRuntime();

    jest.doMock("../../durable/store/RedisStore", () => ({
      RedisStore: RedisStoreMock,
    }));
    jest.doMock("../../durable/bus/RedisEventBus", () => ({
      RedisEventBus: RedisEventBusMock,
    }));
    jest.doMock("../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../durable/core/DurableService", () => ({
      disposeDurableService: jest.fn(async () => {}),
    }));

    let redisDurableResource!: typeof import("../../durable/resources/redisDurableResource").redisDurableResource;
    jest.isolateModules(() => {
      ({
        redisDurableResource,
      } = require("../../durable/resources/redisDurableResource"));
    });

    await redisDurableResource.init!.call(
      { id: "ignored.by.namespace" },
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

    jest.doMock("../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime: jest.fn(async () => ({ service: {} })),
    }));
    jest.doMock("../../durable/core/DurableService", () => ({
      disposeDurableService,
    }));
    jest.doMock("../../durable/store/RedisStore", () => ({
      RedisStore: class {
        constructor(public readonly cfg: unknown) {}
      },
    }));
    jest.doMock("../../durable/bus/RedisEventBus", () => ({
      RedisEventBus: class {
        constructor(public readonly cfg: unknown) {}
      },
    }));

    let redisDurableResource!: typeof import("../../durable/resources/redisDurableResource").redisDurableResource;
    jest.isolateModules(() => {
      ({
        redisDurableResource,
      } = require("../../durable/resources/redisDurableResource"));
    });

    await redisDurableResource.dispose!(
      { service: {} } as any,
      {} as any,
      {} as any,
      { runtimeConfig: null } as any,
    );

    expect(disposeDurableService).not.toHaveBeenCalled();
  });
});
