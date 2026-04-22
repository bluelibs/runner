import {
  defineEvent,
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { symbolResourceWithConfig, type DependencyMapType } from "../../defs";
import { DependencyProcessor } from "../../models/DependencyProcessor";
import * as storeLookup from "../../models/store/StoreLookup";
import { HookDependencyState } from "../../types/storeTypes";
import { ResourceLifecycleMode } from "../../types/runner";
import { createTestFixture } from "../test-utils";

describe("DependencyProcessor scheduler branches", () => {
  it("covers direct dependency traversal branches for readiness checks", () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const aggregateTag = defineTag({
      id: "scheduler-direct-branches-tag",
    });
    const event = defineEvent({
      id: "scheduler-direct-branches-event",
    });

    const taggedResource = defineResource({
      id: "scheduler-direct-branches-resource",
      tags: [aggregateTag],
    });
    const taskDepResource = defineResource({
      id: "scheduler-direct-branches-task-dep",
    });
    const hookDepResource = defineResource({
      id: "scheduler-direct-branches-hook-dep",
    });
    const taskMiddlewareDepResource = defineResource({
      id: "scheduler-direct-branches-task-middleware-dep",
    });
    const resourceMiddlewareDepResource = defineResource({
      id: "scheduler-direct-branches-resource-middleware-dep",
    });
    const directResource = defineResource({
      id: "scheduler-direct-branches-direct-resource",
    });

    const taggedTask = defineTask({
      id: "scheduler-direct-branches-task",
      tags: [aggregateTag],
      dependencies: {
        taskDepResource,
      },
      async run() {
        return "ok";
      },
    });
    const taggedHook = defineHook({
      id: "scheduler-direct-branches-hook",
      on: event,
      tags: [aggregateTag],
      dependencies: {
        hookDepResource,
      },
      async run() {},
    });
    const taggedTaskMiddleware = defineTaskMiddleware({
      id: "scheduler-direct-branches-task-middleware",
      tags: [aggregateTag],
      dependencies: {
        taskMiddlewareDepResource,
      },
      async run({ next, task }) {
        return next(task.input);
      },
    });
    const taggedResourceMiddleware = defineResourceMiddleware({
      id: "scheduler-direct-branches-resource-middleware",
      tags: [aggregateTag],
      dependencies: {
        resourceMiddlewareDepResource,
      },
      async run({ next }) {
        return next();
      },
    });

    const missingOptionalResource = defineResource({
      id: "scheduler-direct-branches-optional-missing",
    });

    const consumer = defineResource({
      id: "scheduler-direct-branches-consumer",
      dependencies: {
        taggedTask,
        aggregateTag,
        duplicateStartupTag: aggregateTag.startup(),
        // Intentionally invalid shape to cover scheduler's unknown dependency branch.
        unknownPrimitiveDependency: 123,
        directResource,
        missingOptionalResource: missingOptionalResource.optional(),
      } as unknown as DependencyMapType,
      async init() {
        return "consumer";
      },
    });

    store.storeGenericItem(aggregateTag);
    store.storeGenericItem(event);
    store.storeGenericItem(taggedResource);
    store.storeGenericItem(taskDepResource);
    store.storeGenericItem(hookDepResource);
    store.storeGenericItem(taskMiddlewareDepResource);
    store.storeGenericItem(resourceMiddlewareDepResource);
    store.storeGenericItem(directResource);
    store.storeGenericItem(taggedTask);
    store.storeGenericItem(taggedHook);
    store.storeGenericItem(taggedTaskMiddleware);
    store.storeGenericItem(taggedResourceMiddleware);
    store.storeGenericItem(consumer);

    store.root = {
      resource: defineResource({ id: "scheduler-direct-branches-root" }),
      config: undefined,
      value: undefined,
      context: {},
      isInitialized: false,
    } as never;

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
      ResourceLifecycleMode.Parallel,
    ) as unknown as {
      resourceScheduler: {
        isResourceReadyForParallelInit: (
          resource: typeof store.resources extends Map<any, infer V>
            ? V
            : never,
        ) => boolean;
      };
    };

    const scheduler = processor.resourceScheduler;
    const consumerStoreResource = store.resources.get(consumer.id)!;

    expect(
      scheduler.isResourceReadyForParallelInit(consumerStoreResource),
    ).toBe(false);

    for (const resource of store.resources.values()) {
      if (resource.resource.id !== consumer.id) {
        resource.isInitialized = true;
      }
    }

    expect(
      scheduler.isResourceReadyForParallelInit(consumerStoreResource),
    ).toBe(true);
  });

  it("covers startup-tag traversal branch and default target set path", () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const aggregateTag = defineTag({
      id: "scheduler-startup-tag-branch-tag",
    });
    const taggedResource = defineResource({
      id: "scheduler-startup-tag-branch-resource",
      tags: [aggregateTag],
    });

    store.storeGenericItem(aggregateTag);
    store.storeGenericItem(taggedResource);
    store.root = {
      resource: defineResource({ id: "scheduler-startup-tag-branch-root" }),
      config: undefined,
      value: undefined,
      context: {},
      isInitialized: false,
    } as never;

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
      ResourceLifecycleMode.Parallel,
    ) as unknown as {
      resourceScheduler: {
        collectResourceDependenciesFromMap: (
          dependencies: unknown,
          consumerId: string,
        ) => string[];
      };
    };

    const collected =
      processor.resourceScheduler.collectResourceDependenciesFromMap(
        {
          startupTag: aggregateTag.startup(),
        },
        "scheduler-startup-tag-branch-consumer",
      );

    expect(collected).toContain(taggedResource.id);
  });

  it("uses canonical resource ids for nested dependency readiness checks", () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const dependency = defineResource({
      id: "scheduler-canonical-dependency",
      init: async () => "dependency",
    });
    const consumer = defineResource({
      id: "scheduler-canonical-consumer",
      dependencies: { dependency },
      init: async () => "consumer",
    });
    const group = defineResource({
      id: "scheduler-canonical-group",
      register: [dependency, consumer],
      init: async () => "group",
    });
    const root = defineResource({
      id: "scheduler-canonical-root",
      register: [group],
      init: async () => "root",
    });

    const runtimeResult = fixture.createRuntimeResult(taskRunner);
    store.initializeStore(root, {}, runtimeResult);

    const dependencyId = store.findIdByDefinition(dependency);
    const consumerId = store.findIdByDefinition(consumer);
    expect(dependencyId).not.toBe(dependency.id);
    expect(consumerId).not.toBe(consumer.id);

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
      ResourceLifecycleMode.Parallel,
    ) as unknown as {
      resourceScheduler: {
        isResourceReadyForParallelInit: (
          resource: typeof store.resources extends Map<any, infer V>
            ? V
            : never,
        ) => boolean;
      };
    };

    const dependencyEntry = store.resources.get(dependencyId)!;
    const consumerEntry = store.resources.get(consumerId)!;

    dependencyEntry.isInitialized = false;
    expect(
      processor.resourceScheduler.isResourceReadyForParallelInit(consumerEntry),
    ).toBe(false);

    dependencyEntry.isInitialized = true;
    expect(
      processor.resourceScheduler.isResourceReadyForParallelInit(consumerEntry),
    ).toBe(true);
  });

  it("marks hook dependency state as error when hook dependency extraction fails", async () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const event = defineEvent({
      id: "scheduler-hook-error-event",
    });
    const missingResource = defineResource({
      id: "scheduler-hook-error-missing-resource",
    });
    const hook = defineHook({
      id: "scheduler-hook-error-hook",
      on: event,
      dependencies: {
        missingResource,
      },
      async run() {},
    });

    store.storeGenericItem(event);
    store.storeGenericItem(hook);
    store.root = {
      resource: defineResource({ id: "scheduler-hook-error-root" }),
      config: undefined,
      value: undefined,
      context: {},
      isInitialized: false,
    } as never;

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
      ResourceLifecycleMode.Parallel,
    ) as unknown as {
      computeHookDependencies: () => Promise<void>;
    };

    await expect(processor.computeHookDependencies()).rejects.toThrow();
    expect(store.hooks.get(hook.id)?.dependencyState).toBe(
      HookDependencyState.Error,
    );
  });

  it("skips hooks without 'on' when attaching listeners", () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    store.root = {
      resource: defineResource({ id: "scheduler-attach-no-on-root" }),
      config: undefined,
      value: undefined,
      context: {},
      isInitialized: false,
    } as never;

    store.hooks.set("scheduler-attach-no-on-hook", {
      hook: {
        id: "scheduler-attach-no-on-hook",
        on: undefined,
        dependencies: {},
      },
      dependencyState: HookDependencyState.Ready,
    } as never);

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
      ResourceLifecycleMode.Parallel,
    );

    const addListenerSpy = jest.spyOn(eventManager, "addListener");
    const addGlobalListenerSpy = jest.spyOn(eventManager, "addGlobalListener");

    processor.attachListeners();

    expect(addListenerSpy).not.toHaveBeenCalled();
    expect(addGlobalListenerSpy).not.toHaveBeenCalled();
  });

  it("covers scheduler source-id fallbacks when store lookup helpers miss", () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
      ResourceLifecycleMode.Parallel,
    ) as unknown as {
      resourceScheduler: { resolveDefinitionId(value: unknown): string };
    };

    const resourceWithConfig = {
      [symbolResourceWithConfig]: true,
      resource: { id: "scheduler-source-id-fallback-resource" },
    };
    const functionWithId = Object.assign(() => undefined, {
      id: "scheduler-source-id-fallback-function",
    });
    const functionWithoutId = () => undefined;

    jest
      .spyOn(storeLookup, "resolveCanonicalIdFromStore")
      .mockReturnValue(null);
    jest.spyOn(storeLookup, "extractRequestedId").mockReturnValue(null);

    expect(schedulerResolve(processor, "scheduler-source-id-fallback")).toBe(
      "scheduler-source-id-fallback",
    );
    expect(schedulerResolve(processor, resourceWithConfig)).toBe(
      "scheduler-source-id-fallback-resource",
    );
    expect(schedulerResolve(processor, functionWithId)).toBe(
      "scheduler-source-id-fallback-function",
    );
    expect(schedulerResolve(processor, functionWithoutId)).toBe(
      String(functionWithoutId),
    );
    expect(schedulerResolve(processor, { id: "" })).toBe("[object Object]");
  });

  it("fails fast when hook array event dependencies cannot be resolved", () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const missingEvent = defineEvent({
      id: "dependency-processor-missing-array-event",
    });
    const hook = defineHook({
      id: "dependency-processor-missing-array-event-hook",
      on: [missingEvent],
      async run() {},
    });
    store.hooks.set(hook.id, {
      hook,
      dependencyState: HookDependencyState.Ready,
      computedDependencies: {},
    } as any);

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
    );

    expect(() => processor.attachListeners()).toThrow(
      /Event "dependency-processor-missing-array-event" not found/i,
    );
  });

  it("fails fast when hook single event dependencies cannot be resolved", () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const missingEvent = defineEvent({
      id: "dependency-processor-missing-single-event",
    });
    const hook = defineHook({
      id: "dependency-processor-missing-single-event-hook",
      on: missingEvent,
      async run() {},
    });
    store.hooks.set(hook.id, {
      hook,
      dependencyState: HookDependencyState.Ready,
      computedDependencies: {},
    } as any);

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
    );

    expect(() => processor.attachListeners()).toThrow(
      /Event "dependency-processor-missing-single-event" not found/i,
    );
  });
});

function schedulerResolve(
  processor: {
    resourceScheduler: { resolveDefinitionId(value: unknown): string };
  },
  value: unknown,
): string {
  return processor.resourceScheduler.resolveDefinitionId(value);
}
