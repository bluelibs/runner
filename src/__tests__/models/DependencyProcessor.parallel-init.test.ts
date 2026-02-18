import {
  defineEvent,
  defineHook,
  defineResource,
  defineTask,
} from "../../define";
import { DependencyProcessor } from "../../models/DependencyProcessor";
import { ResourceInitMode } from "../../types/runner";
import { createTestFixture } from "../test-utils";

describe("DependencyProcessor parallel init internals", () => {
  it("throws when no pending resource is ready for a parallel wave", async () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const missing = defineResource({
      id: "parallel.wave.missing.dep",
    });
    const pending = defineResource({
      id: "parallel.wave.pending",
      dependencies: { missing },
      async init() {
        return "pending";
      },
    });

    store.storeGenericItem(pending);
    store.root = {
      resource: defineResource({ id: "parallel.wave.root" }),
      config: undefined,
      value: undefined,
      context: {},
      isInitialized: false,
    } as any;

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
      ResourceInitMode.Parallel,
    ) as any;

    await expect(
      processor.initializeUninitializedResourcesParallel(),
    ).rejects.toThrow(
      "Could not schedule pending resources for initialization in parallel mode.",
    );
  });

  it("normalizes non-Error parallel init rejections into Error and throws single failure directly", async () => {
    expect.assertions(2);

    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const first = defineResource({
      id: "parallel.wave.first",
      async init() {
        return "first";
      },
    });
    const second = defineResource({
      id: "parallel.wave.second",
      async init() {
        return "second";
      },
    });

    store.storeGenericItem(first);
    store.storeGenericItem(second);
    store.root = {
      resource: defineResource({ id: "parallel.wave.root.2" }),
      config: undefined,
      value: undefined,
      context: {},
      isInitialized: false,
    } as any;

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
      ResourceInitMode.Parallel,
    ) as any;

    jest
      .spyOn(processor, "ensureResourceInitialized")
      .mockImplementation(async (resource: any) => {
        if (resource.resource.id === first.id) {
          throw "non-error rejection";
        }
        resource.isInitialized = true;
      });

    let caught: unknown;
    try {
      await processor.initializeUninitializedResourcesParallel();
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("non-error rejection");
  });

  it("returns early for lazy+parallel startup when there are no startup-required resources", async () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    store.root = {
      resource: defineResource({ id: "parallel.lazy.empty.root" }),
      config: undefined,
      value: undefined,
      context: {},
      isInitialized: false,
    } as any;

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
      ResourceInitMode.Parallel,
      true,
    ) as any;

    const initializeUninitializedResourcesParallelSpy = jest.spyOn(
      processor,
      "initializeUninitializedResourcesParallel",
    );

    await processor.initializeStartupRequiredResourcesParallel();

    expect(initializeUninitializedResourcesParallelSpy).not.toHaveBeenCalled();
  });

  it("collects startup-required resources from hooks/tasks and skips missing optional deps safely", () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const existing = defineResource({
      id: "parallel.lazy.collect.existing",
    });
    const missing = defineResource({
      id: "parallel.lazy.collect.missing",
    });
    const event = defineEvent({
      id: "parallel.lazy.collect.event",
    });

    const hook = defineHook({
      id: "parallel.lazy.collect.hook",
      on: event,
      dependencies: {
        existing,
        missing: missing.optional(),
      },
      async run() {},
    });

    const task = defineTask({
      id: "parallel.lazy.collect.task",
      dependencies: {
        existing,
        missing: missing.optional(),
      },
      async run() {
        return "ok";
      },
    });

    store.storeGenericItem(existing);
    store.storeGenericItem(event);
    store.storeGenericItem(hook);
    store.storeGenericItem(task);

    store.root = {
      resource: defineResource({
        id: "parallel.lazy.collect.root",
        dependencies: { existing },
      }),
      config: undefined,
      value: undefined,
      context: {},
      isInitialized: false,
    } as any;

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
      ResourceInitMode.Parallel,
      true,
    ) as any;

    const originalGet = store.resources.get.bind(store.resources);
    let existingGetCount = 0;
    jest
      .spyOn(store.resources, "get")
      .mockImplementation((resourceId: string) => {
        if (resourceId === existing.id) {
          existingGetCount += 1;
          if (existingGetCount > 1) {
            return undefined as any;
          }
        }
        return originalGet(resourceId as any) as any;
      });

    const required = processor.collectStartupRequiredResourceIds();
    expect(required.has(existing.id)).toBe(true);
    expect(required.has(missing.id)).toBe(false);
  });
});
