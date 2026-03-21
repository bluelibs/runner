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

  it("disposes through disposeDurableService", async () => {
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

    const durable = await durableResource.init!(
      {} as any,
      deps as any,
      {} as any,
    );

    await durableResource.dispose!(
      durable,
      { store: {} } as any,
      {} as any,
      {} as any,
    );

    expect(durable).toBe(fakeDurable);
    expect(disposeDurableService).toHaveBeenCalledWith(
      (durable as any).service,
      { store: {} },
    );
  });
});
