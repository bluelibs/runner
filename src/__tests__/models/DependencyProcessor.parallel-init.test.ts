import {
  defineEvent,
  defineHook,
  defineResourceMiddleware,
  defineResource,
  defineTag,
  defineTask,
  defineTaskMiddleware,
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

  it("collects startup-required resources reachable through tag dependencies", () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const aggregateTag = defineTag({
      id: "parallel.lazy.collect.tag.aggregate",
    });

    const taggedResource = defineResource({
      id: "parallel.lazy.collect.tag.resource",
      tags: [aggregateTag],
    });

    const nestedTaskResource = defineResource({
      id: "parallel.lazy.collect.tag.task.dep.resource",
    });

    const taggedTask = defineTask({
      id: "parallel.lazy.collect.tag.task",
      tags: [aggregateTag],
      dependencies: {
        nestedTaskResource,
      },
      async run() {
        return "ok";
      },
    });

    const consumer = defineResource({
      id: "parallel.lazy.collect.tag.consumer",
      dependencies: {
        aggregateTag,
      },
      async init() {
        return "consumer";
      },
    });

    store.storeGenericItem(aggregateTag);
    store.storeGenericItem(taggedResource);
    store.storeGenericItem(nestedTaskResource);
    store.storeGenericItem(taggedTask);
    store.storeGenericItem(consumer);

    store.root = {
      resource: defineResource({
        id: "parallel.lazy.collect.tag.root",
        dependencies: { consumer },
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

    const required = processor.collectStartupRequiredResourceIds();
    expect(required.has(consumer.id)).toBe(true);
    expect(required.has(taggedResource.id)).toBe(true);
    expect(required.has(nestedTaskResource.id)).toBe(true);
  });

  it("treats tag-matched resources as readiness prerequisites in parallel mode", () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const aggregateTag = defineTag({
      id: "parallel.wave.tag.prereq",
    });

    const dependency = defineResource({
      id: "parallel.wave.tag.prereq.resource",
      tags: [aggregateTag],
      async init() {
        return "dep";
      },
    });

    const consumer = defineResource({
      id: "parallel.wave.tag.prereq.consumer",
      dependencies: {
        aggregateTag,
      },
      async init() {
        return "consumer";
      },
    });

    store.storeGenericItem(aggregateTag);
    store.storeGenericItem(dependency);
    store.storeGenericItem(consumer);
    store.root = {
      resource: defineResource({ id: "parallel.wave.tag.prereq.root" }),
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

    const scheduler = processor.resourceScheduler as {
      isResourceReadyForParallelInit: (
        resource: typeof store.resources extends Map<any, infer V> ? V : never,
      ) => boolean;
    };

    const dependencyStoreResource = store.resources.get(dependency.id)!;
    dependencyStoreResource.isInitialized = false;

    const consumerStoreResource = store.resources.get(consumer.id)!;
    expect(
      scheduler.isResourceReadyForParallelInit(consumerStoreResource),
    ).toBe(false);

    dependencyStoreResource.isInitialized = true;
    expect(
      scheduler.isResourceReadyForParallelInit(consumerStoreResource),
    ).toBe(true);
  });

  it("treats startup() tag dependencies as readiness prerequisites in parallel mode", () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const aggregateTag = defineTag({
      id: "parallel.wave.tag.beforeInit.prereq",
    });

    const dependency = defineResource({
      id: "parallel.wave.tag.beforeInit.prereq.resource",
      tags: [aggregateTag],
      async init() {
        return "dep";
      },
    });

    const consumer = defineResource({
      id: "parallel.wave.tag.beforeInit.prereq.consumer",
      dependencies: {
        aggregateTag: aggregateTag.startup(),
      },
      async init() {
        return "consumer";
      },
    });

    store.storeGenericItem(aggregateTag);
    store.storeGenericItem(dependency);
    store.storeGenericItem(consumer);
    store.root = {
      resource: defineResource({
        id: "parallel.wave.tag.beforeInit.prereq.root",
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
    ) as any;

    const scheduler = processor.resourceScheduler as {
      isResourceReadyForParallelInit: (
        resource: typeof store.resources extends Map<any, infer V> ? V : never,
      ) => boolean;
    };

    const dependencyStoreResource = store.resources.get(dependency.id)!;
    dependencyStoreResource.isInitialized = false;

    const consumerStoreResource = store.resources.get(consumer.id)!;
    expect(
      scheduler.isResourceReadyForParallelInit(consumerStoreResource),
    ).toBe(false);

    dependencyStoreResource.isInitialized = true;
    expect(
      scheduler.isResourceReadyForParallelInit(consumerStoreResource),
    ).toBe(true);
  });

  it("collects resources from tag-matched hooks and middlewares and handles duplicate traversals", () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const aggregateTag = defineTag({
      id: "parallel.collect.tag.full-graph",
    });

    const event = defineEvent({
      id: "parallel.collect.tag.full-graph.event",
    });

    const taggedResource = defineResource({
      id: "parallel.collect.tag.full-graph.resource",
      tags: [aggregateTag],
    });

    const taskDependencyResource = defineResource({
      id: "parallel.collect.tag.full-graph.task.dep.resource",
    });

    const hookDependencyResource = defineResource({
      id: "parallel.collect.tag.full-graph.hook.dep.resource",
    });

    const taskMiddlewareDependencyResource = defineResource({
      id: "parallel.collect.tag.full-graph.task.middleware.dep.resource",
    });

    const resourceMiddlewareDependencyResource = defineResource({
      id: "parallel.collect.tag.full-graph.resource.middleware.dep.resource",
    });

    const taggedTask = defineTask({
      id: "parallel.collect.tag.full-graph.task",
      tags: [aggregateTag],
      dependencies: {
        taskDependencyResource,
      },
      async run() {
        return "ok";
      },
    });

    const taggedHook = defineHook({
      id: "parallel.collect.tag.full-graph.hook",
      on: event,
      tags: [aggregateTag],
      dependencies: {
        hookDependencyResource,
      },
      async run() {},
    });

    const taggedTaskMiddleware = defineTaskMiddleware({
      id: "parallel.collect.tag.full-graph.task.middleware",
      tags: [aggregateTag],
      dependencies: {
        taskMiddlewareDependencyResource,
      },
      async run({ next, task }) {
        return next(task.input);
      },
    });

    const taggedResourceMiddleware = defineResourceMiddleware({
      id: "parallel.collect.tag.full-graph.resource.middleware",
      tags: [aggregateTag],
      dependencies: {
        resourceMiddlewareDependencyResource,
      },
      async run({ next }) {
        return next();
      },
    });

    const consumer = defineResource({
      id: "parallel.collect.tag.full-graph.consumer",
      dependencies: {
        firstTagLookup: aggregateTag,
        secondTagLookup: aggregateTag,
        repeatedResource: taggedResource,
        repeatedTask: taggedTask as any,
        repeatedHook: taggedHook as any,
        repeatedTaskMiddleware: taggedTaskMiddleware as any,
        repeatedResourceMiddleware: taggedResourceMiddleware as any,
      } as any,
      async init() {
        return "consumer";
      },
    });

    store.storeGenericItem(aggregateTag);
    store.storeGenericItem(event);
    store.storeGenericItem(taggedResource);
    store.storeGenericItem(taskDependencyResource);
    store.storeGenericItem(hookDependencyResource);
    store.storeGenericItem(taskMiddlewareDependencyResource);
    store.storeGenericItem(resourceMiddlewareDependencyResource);
    store.storeGenericItem(taggedTask);
    store.storeGenericItem(taggedHook);
    store.storeGenericItem(taggedTaskMiddleware);
    store.storeGenericItem(taggedResourceMiddleware);
    store.storeGenericItem(consumer);

    store.root = {
      resource: defineResource({
        id: "parallel.collect.tag.full-graph.root",
        dependencies: {
          consumer,
        },
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

    const required = processor.collectStartupRequiredResourceIds();
    expect(required.has(consumer.id)).toBe(true);
    expect(required.has(taggedResource.id)).toBe(true);
    expect(required.has(taskDependencyResource.id)).toBe(true);
    expect(required.has(hookDependencyResource.id)).toBe(true);
    expect(required.has(taskMiddlewareDependencyResource.id)).toBe(true);
    expect(required.has(resourceMiddlewareDependencyResource.id)).toBe(true);
  });

  it("handles missing non-resource dependency entries in traversal without crashing", () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const event = defineEvent({
      id: "parallel.collect.missing.entries.event",
    });
    const missingRequiredResource = defineResource({
      id: "parallel.collect.missing.entries.required.resource",
    });
    const missingOptionalResource = defineResource({
      id: "parallel.collect.missing.entries.optional.resource",
    });
    const missingTask = defineTask({
      id: "parallel.collect.missing.entries.task",
      async run() {
        return "ok";
      },
    });
    const missingHook = defineHook({
      id: "parallel.collect.missing.entries.hook",
      on: event,
      async run() {},
    });
    const missingTaskMiddleware = defineTaskMiddleware({
      id: "parallel.collect.missing.entries.task.middleware",
      async run({ next, task }) {
        return next(task.input);
      },
    });
    const missingResourceMiddleware = defineResourceMiddleware({
      id: "parallel.collect.missing.entries.resource.middleware",
      async run({ next }) {
        return next();
      },
    });

    store.root = {
      resource: defineResource({
        id: "parallel.collect.missing.entries.root",
        dependencies: {
          missingRequiredResource,
          missingOptionalResource: missingOptionalResource.optional(),
          missingTask: missingTask as any,
          missingHook: missingHook as any,
          missingTaskMiddleware: missingTaskMiddleware as any,
          missingResourceMiddleware: missingResourceMiddleware as any,
        } as any,
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

    const required = processor.collectStartupRequiredResourceIds();
    expect(required.has(missingRequiredResource.id)).toBe(true);
    expect(required.has(missingOptionalResource.id)).toBe(false);
  });
});
