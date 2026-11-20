import { Logger } from "../../../../models/Logger";
import { defineResource } from "../../../../index";
type DisposeDurableService =
  typeof import("../../../durable/core/DurableService").disposeDurableService;

describe("durable: postgresDurableResource (config-only)", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function mockRuntimeDeps() {
    const createRunnerDurableRuntime = jest.fn(async () => ({
      service: { cooldown: jest.fn(async () => {}) },
    }));
    const disposeDurableService = jest.fn<
      ReturnType<DisposeDurableService>,
      Parameters<DisposeDurableService>
    >(async () => {});
    const PostgresStore = jest.fn(function (
      this: { cfg: unknown },
      cfg: unknown,
    ) {
      this.cfg = cfg;
    });
    const RedisEventBus = jest.fn(function (
      this: { cfg: unknown },
      cfg: unknown,
    ) {
      this.cfg = cfg;
    });
    const MemoryEventBus = jest.fn(function (
      this: { cfg: unknown },
      cfg: unknown,
    ) {
      this.cfg = cfg;
    });
    const RabbitMQQueue = jest.fn(function (
      this: { cfg: unknown },
      cfg: unknown,
    ) {
      this.cfg = cfg;
    });

    jest.doMock("../../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../../durable/core/DurableService", () => ({
      disposeDurableService,
    }));
    jest.doMock("../../../durable/store/PostgresStore", () => ({
      PostgresStore,
    }));
    jest.doMock("../../../durable/bus/RedisEventBus", () => ({
      RedisEventBus,
    }));
    jest.doMock("../../../durable/bus/MemoryEventBus", () => ({
      MemoryEventBus,
    }));
    jest.doMock("../../../durable/queue/RabbitMQQueue", () => ({
      RabbitMQQueue,
    }));

    let postgresDurableResource!: typeof import("../../../durable/resources/postgresDurableResource").postgresDurableResource;
    jest.isolateModules(() => {
      ({
        postgresDurableResource,
      } = require("../../../durable/resources/postgresDurableResource"));
    });
    return {
      postgresDurableResource,
      createRunnerDurableRuntime,
      disposeDurableService,
      PostgresStore,
      RedisEventBus,
      MemoryEventBus,
      RabbitMQQueue,
    };
  }

  it("configures RedisEventBus and RabbitMQQueue when provided, plus cooldown and dispose", async () => {
    const deps = mockRuntimeDeps();
    const customSer = defineResource({
      id: "pg-ser",
      init: async () => ({}) as never,
    });
    const selector = deps.postgresDurableResource.dependencies as unknown as (
      cfg: unknown,
    ) => Record<string, unknown>;
    expect(
      selector({ postgres: { connectionString: "pg://x" } }),
    ).toHaveProperty("serializer");
    expect(
      selector({
        postgres: { connectionString: "pg://x" },
        serializer: customSer,
      }).serializer,
    ).toBe(customSer);
    expect((deps.postgresDurableResource.context as () => unknown)()).toEqual({
      runtimeConfig: null,
    });

    const forked = deps.postgresDurableResource.fork("pg-wf");
    const resourceContext = { runtimeConfig: null };
    const durable = await forked.init!(
      {
        namespace: "pg-ns",
        postgres: {
          connectionString: "postgres://localhost/app",
          autoCreateTables: false,
        },
        store: { namespace: "store-ns" },
        redis: { url: "redis://localhost:6379" },
        eventBus: { prefix: "custom:bus:" },
        queue: {
          url: "amqp://localhost",
          consume: true,
          quorum: true,
          prefetch: 4,
        },
      },
      {
        taskRunner: {} as never,
        eventManager: {} as never,
        runnerStore: {} as never,
        logger: new Logger({
          printThreshold: null,
          printStrategy: "pretty",
          bufferLogs: false,
        }),
        serializer: {} as never,
      },
      resourceContext as never,
    );

    expect(deps.PostgresStore).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: "postgres://localhost/app",
        autoCreateTables: false,
        namespace: "store-ns",
      }),
    );
    expect(deps.RedisEventBus).toHaveBeenCalledTimes(1);
    expect(deps.MemoryEventBus).not.toHaveBeenCalled();
    expect(deps.RabbitMQQueue).toHaveBeenCalledTimes(1);
    expect(deps.createRunnerDurableRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ roles: { queueConsumer: true } }),
      expect.anything(),
    );

    await forked.cooldown!(
      durable,
      {} as never,
      {} as never,
      resourceContext as never,
    );
    await forked.dispose!(
      durable,
      {} as never,
      {} as never,
      resourceContext as never,
    );
    expect(deps.disposeDurableService).toHaveBeenCalledTimes(1);
  });

  it("falls back to MemoryEventBus, disables queue when omitted or disabled, and handles uninitialized lifecycle", async () => {
    const deps = mockRuntimeDeps();
    const forked = deps.postgresDurableResource.fork("pg-single");
    await forked.init!(
      {
        postgres: {
          poolConfig: { connectionString: "postgres://localhost/app" },
        },
        queue: { url: "amqp://localhost", enabled: false },
      },
      {
        taskRunner: {} as never,
        eventManager: {} as never,
        runnerStore: {} as never,
        logger: undefined as never,
        serializer: {} as never,
      },
      { runtimeConfig: null } as never,
    );

    expect(deps.MemoryEventBus).toHaveBeenCalledTimes(1);
    expect(deps.RedisEventBus).not.toHaveBeenCalled();
    expect(deps.RabbitMQQueue).not.toHaveBeenCalled();
    expect(deps.PostgresStore).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: "pg-single" }),
    );

    await forked.cooldown!({} as never, {} as never, {} as never, {
      runtimeConfig: null,
    });
    await forked.dispose!({} as never, {} as never, {} as never, {
      runtimeConfig: null,
    });
    expect(deps.disposeDurableService).not.toHaveBeenCalled();
  });
});
