import type { DurableResource } from "../../durable/core/DurableResource";

type CreateRunnerDurableRuntime =
  typeof import("../../durable/core/createRunnerDurableRuntime").createRunnerDurableRuntime;
type DisposeDurableService =
  typeof import("../../durable/core/DurableService").disposeDurableService;

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

  it("initializes with a queue when worker=true and disposes via stored runtimeConfig", async () => {
    const { createRunnerDurableRuntime, fakeDurable } =
      mockCreateRunnerDurableRuntime();
    const { disposeDurableService } = mockDisposeDurableService();

    jest.doMock("../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../durable/core/DurableService", () => ({
      disposeDurableService,
    }));

    let memoryDurableResource!: typeof import("../../durable/resources/memoryDurableResource").memoryDurableResource;
    jest.isolateModules(() => {
      ({
        memoryDurableResource,
      } = require("../../durable/resources/memoryDurableResource"));
    });

    expect(memoryDurableResource.context?.()).toEqual({ runtimeConfig: null });

    const ctx = { runtimeConfig: null as any };
    const durable = await memoryDurableResource.init!.call(
      { id: "tenantA.durable" },
      { worker: true },
      deps as any,
      ctx as any,
    );

    expect(durable).toBe(fakeDurable);
    expect(createRunnerDurableRuntime).toHaveBeenCalledTimes(1);
    const runtimeConfig = createRunnerDurableRuntime.mock.calls[0]?.[0];
    expect(runtimeConfig?.worker).toBe(true);
    expect(runtimeConfig?.queue).toBeDefined();
    expect(ctx.runtimeConfig).toBe(runtimeConfig);

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

  it("defaults to no queue and worker=false when not configured", async () => {
    const { createRunnerDurableRuntime } = mockCreateRunnerDurableRuntime();
    jest.doMock("../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../durable/core/DurableService", () => ({
      disposeDurableService: jest.fn(async () => {}),
    }));

    let memoryDurableResource!: typeof import("../../durable/resources/memoryDurableResource").memoryDurableResource;
    jest.isolateModules(() => {
      ({
        memoryDurableResource,
      } = require("../../durable/resources/memoryDurableResource"));
    });

    await memoryDurableResource.init!.call(
      { id: "tenantA.durable" },
      {},
      deps as any,
      { runtimeConfig: null } as any,
    );

    const runtimeConfig = createRunnerDurableRuntime.mock.calls[0]?.[0];
    expect(runtimeConfig?.queue).toBeUndefined();
    expect(runtimeConfig?.worker).toBe(false);
  });

  it("dispose is a no-op if init never stored runtimeConfig", async () => {
    const { disposeDurableService } = mockDisposeDurableService();
    jest.doMock("../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime: jest.fn(async () => ({ service: {} })),
    }));
    jest.doMock("../../durable/core/DurableService", () => ({
      disposeDurableService,
    }));

    let memoryDurableResource!: typeof import("../../durable/resources/memoryDurableResource").memoryDurableResource;
    jest.isolateModules(() => {
      ({
        memoryDurableResource,
      } = require("../../durable/resources/memoryDurableResource"));
    });

    await memoryDurableResource.dispose!(
      { service: {} } as any,
      {} as any,
      {} as any,
      { runtimeConfig: null } as any,
    );

    expect(disposeDurableService).not.toHaveBeenCalled();
  });
});
