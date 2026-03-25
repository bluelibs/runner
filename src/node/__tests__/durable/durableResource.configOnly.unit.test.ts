import type { DurableResource } from "../../durable/core/DurableResource";

type CreateRunnerDurableRuntime =
  typeof import("../../durable/core/createRunnerDurableRuntime").createRunnerDurableRuntime;
type DisposeDurableService =
  typeof import("../../durable/core/DurableService").disposeDurableService;

describe("durable: durableResource (config-only)", () => {
  const deps = {
    taskRunner: {} as any,
    eventManager: {} as any,
    runnerStore: { tasks: new Map() } as any,
    logger: {} as any,
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

  it("delegates cooldown to the durable service", async () => {
    const { createRunnerDurableRuntime } = mockCreateRunnerDurableRuntime();

    jest.doMock("../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../durable/core/DurableService", () => ({
      disposeDurableService: jest.fn(async () => {}),
    }));

    let durableResource!: typeof import("../../durable/core/resource").durableResource;
    jest.isolateModules(() => {
      ({ durableResource } = require("../../durable/core/resource"));
    });

    const cooldown = jest.fn(async () => {});
    await durableResource.cooldown!(
      { service: { cooldown } } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    expect(cooldown).toHaveBeenCalledTimes(1);
  });

  it("resolves queue wrappers into runtime config and disposes through it", async () => {
    const { createRunnerDurableRuntime, fakeDurable } =
      mockCreateRunnerDurableRuntime();
    const { disposeDurableService } = mockDisposeDurableService();

    jest.doMock("../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../durable/core/DurableService", () => ({
      disposeDurableService,
    }));

    let durableResource!: typeof import("../../durable/core/resource").durableResource;
    jest.isolateModules(() => {
      ({ durableResource } = require("../../durable/core/resource"));
    });

    expect(durableResource.context?.()).toEqual({ runtimeConfig: null });

    const transport = {
      enqueue: jest.fn(),
      consume: jest.fn(),
      ack: jest.fn(),
      nack: jest.fn(),
    };
    const runtimeContext = { runtimeConfig: null as any };
    const durable = await durableResource.init!(
      {
        store: {} as any,
        queue: transport,
        roles: { queueConsumer: true },
      } as any,
      deps as any,
      runtimeContext as any,
    );

    await durableResource.dispose!(
      durable,
      {} as any,
      {} as any,
      runtimeContext as any,
    );

    expect(durable).toBe(fakeDurable);
    expect(createRunnerDurableRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        store: expect.anything(),
        queue: transport,
        roles: { queueConsumer: true },
      }),
      expect.anything(),
    );
    expect(disposeDurableService).toHaveBeenCalledWith(
      (durable as any).service,
      runtimeContext.runtimeConfig,
    );
  });

  it("skips dispose when init never stored runtimeConfig", async () => {
    const { disposeDurableService } = mockDisposeDurableService();

    jest.doMock("../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime: jest.fn(async () => ({ service: {} })),
    }));
    jest.doMock("../../durable/core/DurableService", () => ({
      disposeDurableService,
    }));

    let durableResource!: typeof import("../../durable/core/resource").durableResource;
    jest.isolateModules(() => {
      ({ durableResource } = require("../../durable/core/resource"));
    });

    await durableResource.dispose!(
      { service: {} } as any,
      {} as any,
      {} as any,
      { runtimeConfig: null } as any,
    );

    expect(disposeDurableService).not.toHaveBeenCalled();
  });

  it("keeps direct queue transports producer-only by default", async () => {
    const { createRunnerDurableRuntime } = mockCreateRunnerDurableRuntime();

    jest.doMock("../../durable/core/createRunnerDurableRuntime", () => ({
      createRunnerDurableRuntime,
    }));
    jest.doMock("../../durable/core/DurableService", () => ({
      disposeDurableService: jest.fn(async () => {}),
    }));

    let durableResource!: typeof import("../../durable/core/resource").durableResource;
    jest.isolateModules(() => {
      ({ durableResource } = require("../../durable/core/resource"));
    });

    const transport = {
      enqueue: jest.fn(),
      consume: jest.fn(),
      ack: jest.fn(),
      nack: jest.fn(),
    };

    await durableResource.init!(
      {
        store: {} as any,
        queue: transport,
      } as any,
      deps as any,
      { runtimeConfig: null } as any,
    );

    expect(createRunnerDurableRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: transport,
      }),
      expect.anything(),
    );
    expect(createRunnerDurableRuntime.mock.calls[0]?.[0].roles).toBeUndefined();
  });
});
