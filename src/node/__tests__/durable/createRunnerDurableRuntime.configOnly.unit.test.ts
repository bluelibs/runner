import type { Logger } from "../../../models/Logger";

type InitDurableService =
  typeof import("../../durable/core/DurableService").initDurableService;
type InitDurableWorker =
  typeof import("../../durable/core/DurableWorker").initDurableWorker;

describe("durable: createRunnerDurableRuntime (config-only)", () => {
  const deps = {
    taskRunner: {} as any,
    eventManager: {} as any,
    runnerStore: {
      tasks: new Map(),
      findIdByDefinition: jest.fn(),
    } as any,
    logger: {
      with: jest.fn(() => ({
        with: jest.fn(() => ({})),
      })),
    } as unknown as Logger,
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

  function mockInitDurableWorker() {
    const fakeWorker = {
      stop: jest.fn(async () => {}),
    };

    const initDurableWorker = jest.fn<
      ReturnType<InitDurableWorker>,
      Parameters<InitDurableWorker>
    >(async () => fakeWorker as any);

    return { initDurableWorker, fakeWorker };
  }

  it("defaults recovery.enabledOnInit to true when worker=true", async () => {
    const { initDurableService, fakeService } = mockInitDurableService();
    const { initDurableWorker } = mockInitDurableWorker();

    jest.doMock("../../durable/core/DurableService", () => ({
      initDurableService,
    }));
    jest.doMock("../../durable/core/DurableWorker", () => ({
      initDurableWorker,
    }));

    let createRunnerDurableRuntime!: typeof import("../../durable/core/createRunnerDurableRuntime").createRunnerDurableRuntime;
    jest.isolateModules(() => {
      ({
        createRunnerDurableRuntime,
      } = require("../../durable/core/createRunnerDurableRuntime"));
    });

    const durable = await createRunnerDurableRuntime(
      {
        store: {} as any,
        queue: {} as any,
        worker: true,
      },
      deps,
    );

    expect(durable).toBeDefined();
    expect(initDurableService).toHaveBeenCalledTimes(1);
    expect(initDurableService.mock.calls[0]?.[0].recovery).toEqual({
      enabledOnInit: true,
    });
    expect(initDurableWorker).toHaveBeenCalledTimes(1);
    expect(fakeService.registerWorker).toHaveBeenCalledTimes(1);
  });

  it("defaults recovery.enabledOnInit to false when worker=false", async () => {
    const { initDurableService } = mockInitDurableService();

    jest.doMock("../../durable/core/DurableService", () => ({
      initDurableService,
    }));
    jest.doMock("../../durable/core/DurableWorker", () => ({
      initDurableWorker: jest.fn(),
    }));

    let createRunnerDurableRuntime!: typeof import("../../durable/core/createRunnerDurableRuntime").createRunnerDurableRuntime;
    jest.isolateModules(() => {
      ({
        createRunnerDurableRuntime,
      } = require("../../durable/core/createRunnerDurableRuntime"));
    });

    const durable = await createRunnerDurableRuntime(
      {
        store: {} as any,
        worker: false,
      },
      deps,
    );

    expect(durable).toBeDefined();
    expect(initDurableService).toHaveBeenCalledTimes(1);
    expect(initDurableService.mock.calls[0]?.[0].recovery).toEqual({
      enabledOnInit: false,
    });
  });

  it("respects an explicit recovery.enabledOnInit override", async () => {
    const { initDurableService } = mockInitDurableService();

    jest.doMock("../../durable/core/DurableService", () => ({
      initDurableService,
    }));
    jest.doMock("../../durable/core/DurableWorker", () => ({
      initDurableWorker: jest.fn(),
    }));

    let createRunnerDurableRuntime!: typeof import("../../durable/core/createRunnerDurableRuntime").createRunnerDurableRuntime;
    jest.isolateModules(() => {
      ({
        createRunnerDurableRuntime,
      } = require("../../durable/core/createRunnerDurableRuntime"));
    });

    const durable = await createRunnerDurableRuntime(
      {
        store: {} as any,
        worker: true,
        recovery: { enabledOnInit: false, concurrency: 3 },
      },
      deps,
    );

    expect(durable).toBeDefined();
    expect(initDurableService).toHaveBeenCalledTimes(1);
    expect(initDurableService.mock.calls[0]?.[0].recovery).toEqual({
      enabledOnInit: false,
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

    jest.doMock("../../durable/core/DurableService", () => ({
      initDurableService,
    }));
    jest.doMock("../../durable/core/DurableWorker", () => ({
      initDurableWorker: jest.fn(),
    }));

    let createRunnerDurableRuntime!: typeof import("../../durable/core/createRunnerDurableRuntime").createRunnerDurableRuntime;
    jest.isolateModules(() => {
      ({
        createRunnerDurableRuntime,
      } = require("../../durable/core/createRunnerDurableRuntime"));
    });

    await createRunnerDurableRuntime(
      {
        store: {} as any,
        worker: false,
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

    jest.doMock("../../durable/core/DurableService", () => ({
      initDurableService,
    }));
    jest.doMock("../../durable/core/DurableWorker", () => ({
      initDurableWorker: jest.fn(),
    }));

    let createRunnerDurableRuntime!: typeof import("../../durable/core/createRunnerDurableRuntime").createRunnerDurableRuntime;
    jest.isolateModules(() => {
      ({
        createRunnerDurableRuntime,
      } = require("../../durable/core/createRunnerDurableRuntime"));
    });

    await createRunnerDurableRuntime(
      {
        store: {} as any,
        worker: false,
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
