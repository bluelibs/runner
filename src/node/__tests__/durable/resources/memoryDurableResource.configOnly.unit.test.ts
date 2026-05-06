import { resources, Serializer } from "../../../../index";
import { RunnerMode } from "../../../../types/runner";
import type { DurableResource } from "../../../durable/core/DurableResource";

type CreateRunnerDurableRuntime =
  typeof import("../../../durable/core/createRunnerDurableRuntime").createRunnerDurableRuntime;
type DisposeDurableService =
  typeof import("../../../durable/core/DurableService").disposeDurableService;

describe("durable: memoryDurableResource (config-only)", () => {
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

  it("initializes with a queue when queue.consume=true and disposes via stored runtimeConfig", async () => {
    const { createRunnerDurableRuntime, fakeDurable } =
      mockCreateRunnerDurableRuntime();
    const { disposeDurableService } = mockDisposeDurableService();

    jest.doMock("../../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../../durable/core/DurableService", () => ({
      disposeDurableService,
    }));

    let memoryDurableResource!: typeof import("../../../durable/resources/memoryDurableResource").memoryDurableResource;
    jest.isolateModules(() => {
      ({
        memoryDurableResource,
      } = require("../../../durable/resources/memoryDurableResource"));
    });

    expect(memoryDurableResource.context?.()).toEqual({ runtimeConfig: null });

    const ctx = { runtimeConfig: null as any };
    const durable = await memoryDurableResource.init!.call(
      { id: "tenantA-durable" },
      { queue: { consume: true } },
      deps as any,
      ctx as any,
    );

    expect(durable).toBe(fakeDurable);
    expect(createRunnerDurableRuntime).toHaveBeenCalledTimes(1);
    const runtimeConfig = createRunnerDurableRuntime.mock.calls[0]?.[0];
    expect(runtimeConfig?.queue).toBeDefined();
    expect(ctx.runtimeConfig).toBe(runtimeConfig);
    expect(runtimeConfig?.roles).toEqual({
      queueConsumer: true,
    });

    await memoryDurableResource.dispose!(
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

  it("defaults to no queue when not configured", async () => {
    const { createRunnerDurableRuntime } = mockCreateRunnerDurableRuntime();
    jest.doMock("../../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../../durable/core/DurableService", () => ({
      disposeDurableService: jest.fn(async () => {}),
    }));

    let memoryDurableResource!: typeof import("../../../durable/resources/memoryDurableResource").memoryDurableResource;
    jest.isolateModules(() => {
      ({
        memoryDurableResource,
      } = require("../../../durable/resources/memoryDurableResource"));
    });

    await memoryDurableResource.init!.call(
      { id: "tenantA-durable" },
      {},
      deps as any,
      { runtimeConfig: null } as any,
    );

    const runtimeConfig = createRunnerDurableRuntime.mock.calls[0]?.[0];
    expect(runtimeConfig?.queue).toBeUndefined();
  });

  it("creates a queue by default when the queue block is present", async () => {
    const { createRunnerDurableRuntime } = mockCreateRunnerDurableRuntime();
    jest.doMock("../../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../../durable/core/DurableService", () => ({
      disposeDurableService: jest.fn(async () => {}),
    }));

    let memoryDurableResource!: typeof import("../../../durable/resources/memoryDurableResource").memoryDurableResource;
    jest.isolateModules(() => {
      ({
        memoryDurableResource,
      } = require("../../../durable/resources/memoryDurableResource"));
    });

    await memoryDurableResource.init!.call(
      { id: "tenantA-durable" },
      { queue: {} },
      deps as any,
      { runtimeConfig: null } as any,
    );

    const runtimeConfig = createRunnerDurableRuntime.mock.calls[0]?.[0];
    expect(runtimeConfig?.queue).toBeDefined();
  });

  it("does not start an embedded worker when queue.consume is omitted", async () => {
    const { createRunnerDurableRuntime } = mockCreateRunnerDurableRuntime();
    jest.doMock("../../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../../durable/core/DurableService", () => ({
      disposeDurableService: jest.fn(async () => {}),
    }));

    let memoryDurableResource!: typeof import("../../../durable/resources/memoryDurableResource").memoryDurableResource;
    jest.isolateModules(() => {
      ({
        memoryDurableResource,
      } = require("../../../durable/resources/memoryDurableResource"));
    });

    await memoryDurableResource.init!.call(
      { id: "tenantA-durable" },
      { queue: {} },
      deps as any,
      { runtimeConfig: null } as any,
    );

    const runtimeConfig = createRunnerDurableRuntime.mock.calls[0]?.[0];
    expect(runtimeConfig?.roles).toEqual({
      queueConsumer: false,
    });
  });

  it("creates a persistent store when persist.filePath is configured", async () => {
    const { createRunnerDurableRuntime } = mockCreateRunnerDurableRuntime();
    jest.doMock("../../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../../durable/core/DurableService", () => ({
      disposeDurableService: jest.fn(async () => {}),
    }));

    let memoryDurableResource!: typeof import("../../../durable/resources/memoryDurableResource").memoryDurableResource;
    let PersistentMemoryStore!: typeof import("../../../durable/store/PersistentMemoryStore").PersistentMemoryStore;
    jest.isolateModules(() => {
      ({
        memoryDurableResource,
      } = require("../../../durable/resources/memoryDurableResource"));
      ({
        PersistentMemoryStore,
      } = require("../../../durable/store/PersistentMemoryStore"));
    });

    await memoryDurableResource.init!.call(
      { id: "tenantA-durable" },
      { persist: { filePath: "./tmp/durable.json" } },
      deps as any,
      { runtimeConfig: null } as any,
    );

    const runtimeConfig = createRunnerDurableRuntime.mock.calls[0]?.[0];
    expect(runtimeConfig?.store).toBeInstanceOf(PersistentMemoryStore);
    expect(runtimeConfig?.queue).toBeUndefined();
  });

  it("defaults serializer dependency selection to resources.serializer", () => {
    let memoryDurableResource!: typeof import("../../../durable/resources/memoryDurableResource").memoryDurableResource;
    jest.isolateModules(() => {
      ({
        memoryDurableResource,
      } = require("../../../durable/resources/memoryDurableResource"));
    });

    const dependencies =
      typeof memoryDurableResource.dependencies === "function"
        ? memoryDurableResource.dependencies({}, RunnerMode.TEST)
        : memoryDurableResource.dependencies;

    expect((dependencies as any).serializer.id).toBe(resources.serializer.id);
  });

  it("uses a custom serializer resource for persistent snapshots when configured", async () => {
    class PersistentMemoryStoreMock {
      constructor(public readonly cfg: unknown) {}
    }

    const { createRunnerDurableRuntime } = mockCreateRunnerDurableRuntime();
    const customSerializerResource = resources.serializer.fork(
      "tests-durable-memory-serializer",
    );
    const customSerializer = new Serializer({ pretty: true });

    jest.doMock("../../../durable/store/PersistentMemoryStore", () => ({
      PersistentMemoryStore: PersistentMemoryStoreMock,
    }));
    jest.doMock("../../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../../durable/core/DurableService", () => ({
      disposeDurableService: jest.fn(async () => {}),
    }));

    let memoryDurableResource!: typeof import("../../../durable/resources/memoryDurableResource").memoryDurableResource;
    jest.isolateModules(() => {
      ({
        memoryDurableResource,
      } = require("../../../durable/resources/memoryDurableResource"));
    });

    const dependencies =
      typeof memoryDurableResource.dependencies === "function"
        ? memoryDurableResource.dependencies(
            {
              serializer: customSerializerResource,
            },
            RunnerMode.TEST,
          )
        : memoryDurableResource.dependencies;

    expect((dependencies as any).serializer).toBe(customSerializerResource);

    await memoryDurableResource.init!.call(
      { id: "tenantA-durable" },
      {
        persist: { filePath: "./tmp/durable.json" },
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
        filePath: "./tmp/durable.json",
        serializer: customSerializer,
      }),
    );
  });

  it("allows queue.enabled=false to disable queue creation explicitly", async () => {
    const { createRunnerDurableRuntime } = mockCreateRunnerDurableRuntime();
    jest.doMock("../../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../../durable/core/DurableService", () => ({
      disposeDurableService: jest.fn(async () => {}),
    }));

    let memoryDurableResource!: typeof import("../../../durable/resources/memoryDurableResource").memoryDurableResource;
    jest.isolateModules(() => {
      ({
        memoryDurableResource,
      } = require("../../../durable/resources/memoryDurableResource"));
    });

    await memoryDurableResource.init!.call(
      { id: "tenantA-durable" },
      { queue: { enabled: false, consume: true } },
      deps as any,
      { runtimeConfig: null } as any,
    );

    const runtimeConfig = createRunnerDurableRuntime.mock.calls[0]?.[0];
    expect(runtimeConfig?.queue).toBeUndefined();
  });

  it("dispose is a no-op if init never stored runtimeConfig", async () => {
    const { disposeDurableService } = mockDisposeDurableService();
    jest.doMock("../../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime: jest.fn(async () => ({ service: {} })),
    }));
    jest.doMock("../../../durable/core/DurableService", () => ({
      disposeDurableService,
    }));

    let memoryDurableResource!: typeof import("../../../durable/resources/memoryDurableResource").memoryDurableResource;
    jest.isolateModules(() => {
      ({
        memoryDurableResource,
      } = require("../../../durable/resources/memoryDurableResource"));
    });

    await memoryDurableResource.dispose!(
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

    let memoryDurableResource!: typeof import("../../../durable/resources/memoryDurableResource").memoryDurableResource;
    jest.isolateModules(() => {
      ({
        memoryDurableResource,
      } = require("../../../durable/resources/memoryDurableResource"));
    });

    const cooldown = jest.fn(async () => {});
    await memoryDurableResource.cooldown!(
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

    let memoryDurableResource!: typeof import("../../../durable/resources/memoryDurableResource").memoryDurableResource;
    jest.isolateModules(() => {
      ({
        memoryDurableResource,
      } = require("../../../durable/resources/memoryDurableResource"));
    });

    const cooldown = jest.fn(async () => {});
    await memoryDurableResource.cooldown!(
      { service: { cooldown } } as any,
      {} as any,
      {} as any,
      { runtimeConfig: null } as any,
    );

    expect(cooldown).not.toHaveBeenCalled();
  });
});
