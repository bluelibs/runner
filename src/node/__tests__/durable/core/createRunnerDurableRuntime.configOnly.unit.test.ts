import type { Logger } from "../../../../models/Logger";

type InitDurableService =
  typeof import("../../../durable/core/DurableService").initDurableService;
describe("durable: createRunnerDurableRuntime (config-only)", () => {
  const createLoggerMock = () => {
    const logger = {
      with: jest.fn(),
    };
    logger.with.mockReturnValue(logger);
    return logger;
  };

  const deps = {
    taskRunner: {} as any,
    eventManager: {} as any,
    runnerStore: {
      tasks: new Map(),
      findIdByDefinition: jest.fn(),
    } as any,
    logger: createLoggerMock() as unknown as Logger,
  };

  beforeEach(() => {
    jest.resetModules();
  });

  function mockInitDurableService() {
    const fakeService = {
      registerWorker: jest.fn(),
    } as any;

    const initDurableService = jest.fn<
      ReturnType<InitDurableService>,
      Parameters<InitDurableService>
    >(async () => fakeService);

    return { initDurableService, fakeService };
  }

  it("starts an embedded queue consumer only when resources request it", async () => {
    const { initDurableService, fakeService } = mockInitDurableService();
    const queue = {
      consume: jest.fn(async () => {}),
      ack: jest.fn(),
      nack: jest.fn(),
    };

    jest.doMock("../../../durable/core/DurableService", () => ({
      initDurableService,
    }));

    let createRunnerDurableRuntime!: typeof import("../../../durable/core/createRunnerDurableRuntime").createRunnerDurableRuntime;
    jest.isolateModules(() => {
      ({
        createRunnerDurableRuntime,
      } = require("../../../durable/core/createRunnerDurableRuntime"));
    });

    const durable = await createRunnerDurableRuntime(
      {
        store: {} as any,
        queue: queue as any,
        roles: { queueConsumer: true },
      },
      deps,
    );

    expect(durable).toBeDefined();
    expect(initDurableService).toHaveBeenCalledTimes(1);
    expect(initDurableService.mock.calls[0]?.[0].recovery).toEqual({});
    expect(queue.consume).toHaveBeenCalledTimes(1);
    expect(fakeService.registerWorker).toHaveBeenCalledTimes(1);
  });

  it("respects an explicit recovery.onStartup override", async () => {
    const { initDurableService } = mockInitDurableService();

    jest.doMock("../../../durable/core/DurableService", () => ({
      initDurableService,
    }));

    let createRunnerDurableRuntime!: typeof import("../../../durable/core/createRunnerDurableRuntime").createRunnerDurableRuntime;
    jest.isolateModules(() => {
      ({
        createRunnerDurableRuntime,
      } = require("../../../durable/core/createRunnerDurableRuntime"));
    });

    const durable = await createRunnerDurableRuntime(
      {
        store: {} as any,
        recovery: { onStartup: false, concurrency: 3 },
      },
      deps,
    );

    expect(durable).toBeDefined();
    expect(initDurableService).toHaveBeenCalledTimes(1);
    expect(initDurableService.mock.calls[0]?.[0].recovery).toEqual({
      onStartup: false,
      concurrency: 3,
    });
  });

  it("resolves legacy source task ids when only the canonical store id is registered", async () => {
    const { initDurableService } = mockInitDurableService();
    const legacyTask = { id: "legacy.task.id" };
    const canonicalTaskId = "app.tasks.legacy.task.id";
    const runnerStore = {
      tasks: new Map([[canonicalTaskId, { task: legacyTask }]]),
      findIdByDefinition: jest.fn(() => canonicalTaskId),
    } as any;

    jest.doMock("../../../durable/core/DurableService", () => ({
      initDurableService,
    }));

    let createRunnerDurableRuntime!: typeof import("../../../durable/core/createRunnerDurableRuntime").createRunnerDurableRuntime;
    jest.isolateModules(() => {
      ({
        createRunnerDurableRuntime,
      } = require("../../../durable/core/createRunnerDurableRuntime"));
    });

    await createRunnerDurableRuntime(
      {
        store: {} as any,
      },
      {
        ...deps,
        runnerStore,
      },
    );

    const taskResolver = initDurableService.mock.calls[0]?.[0].taskResolver;
    expect(taskResolver?.(canonicalTaskId)).toBe(legacyTask);
    expect(taskResolver?.("legacy.task.id")).toBe(legacyTask);
    expect(taskResolver?.("missing.task")).toBeUndefined();
  });

  it("returns undefined for ambiguous legacy task ids", async () => {
    const { initDurableService } = mockInitDurableService();
    const sharedTaskId = "legacy.task.id";
    const runnerStore = {
      tasks: new Map([
        ["app.tasks.first", { task: { id: sharedTaskId } }],
        ["app.tasks.second", { task: { id: sharedTaskId } }],
      ]),
      findIdByDefinition: jest.fn((task: { id: string }) => task.id),
    } as any;

    jest.doMock("../../../durable/core/DurableService", () => ({
      initDurableService,
    }));

    let createRunnerDurableRuntime!: typeof import("../../../durable/core/createRunnerDurableRuntime").createRunnerDurableRuntime;
    jest.isolateModules(() => {
      ({
        createRunnerDurableRuntime,
      } = require("../../../durable/core/createRunnerDurableRuntime"));
    });

    await createRunnerDurableRuntime(
      {
        store: {} as any,
      },
      {
        ...deps,
        runnerStore,
      },
    );

    const taskResolver = initDurableService.mock.calls[0]?.[0].taskResolver;
    expect(taskResolver?.(sharedTaskId)).toBeUndefined();
  });
});
