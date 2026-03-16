import {
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { ResourceScheduler } from "../../models/dependency-processor/ResourceScheduler";

type TestStore = {
  root: { resource: { id: string } };
  resources: Map<string, any>;
  tasks: Map<string, any>;
  hooks: Map<string, any>;
  taskMiddlewares: Map<string, any>;
  resourceMiddlewares: Map<string, any>;
  tags: Map<string, any>;
  getTagAccessor: jest.Mock;
  recordInitWave: jest.Mock;
};

function createSchedulerStore(overrides?: Partial<TestStore>): TestStore {
  return {
    root: { resource: { id: "root" } },
    resources: new Map<string, any>(),
    tasks: new Map<string, any>(),
    hooks: new Map<string, any>(),
    taskMiddlewares: new Map<string, any>(),
    resourceMiddlewares: new Map<string, any>(),
    tags: new Map<string, any>(),
    getTagAccessor: jest.fn(() => ({
      resources: [],
      tasks: [],
      hooks: [],
      taskMiddlewares: [],
      resourceMiddlewares: [],
    })),
    recordInitWave: jest.fn(),
    ...overrides,
  };
}

describe("ResourceScheduler coverage gaps", () => {
  it("handles success, single failures, aggregate failures, and blocked waves in parallel init", async () => {
    const root = defineResource({ id: "root" });
    const readyResource = defineResource({
      id: "ready-resource",
      dependencies: {},
    });

    const successStore = createSchedulerStore();
    successStore.resources.set(root.id, {
      resource: root,
      isInitialized: true,
    });
    successStore.resources.set(readyResource.id, {
      resource: readyResource,
      isInitialized: false,
    });
    const successScheduler = new ResourceScheduler(
      successStore as any,
      async (resource) => {
        resource.isInitialized = true;
      },
    );

    await expect(
      successScheduler.initializeUninitializedResourcesParallel(),
    ).resolves.toBeUndefined();
    expect(successStore.recordInitWave).toHaveBeenCalledWith([
      readyResource.id,
    ]);

    const singleFailureStore = createSchedulerStore();
    singleFailureStore.resources.set(root.id, {
      resource: root,
      isInitialized: true,
    });
    singleFailureStore.resources.set(readyResource.id, {
      resource: readyResource,
      isInitialized: false,
    });
    const singleFailure = new Error("resource-single-failure");
    const singleFailureScheduler = new ResourceScheduler(
      singleFailureStore as any,
      async () => {
        throw singleFailure;
      },
    );

    await expect(
      singleFailureScheduler.initializeUninitializedResourcesParallel(),
    ).rejects.toBe(singleFailure);

    const aggregateStore = createSchedulerStore();
    const first = defineResource({ id: "aggregate-first", dependencies: {} });
    const second = defineResource({ id: "aggregate-second", dependencies: {} });
    aggregateStore.resources.set(root.id, {
      resource: root,
      isInitialized: true,
    });
    aggregateStore.resources.set(first.id, {
      resource: first,
      isInitialized: false,
    });
    aggregateStore.resources.set(second.id, {
      resource: second,
      isInitialized: false,
    });
    const aggregateScheduler = new ResourceScheduler(
      aggregateStore as any,
      async (resource) => {
        if (resource.resource.id === first.id) {
          throw new Error("first");
        }
        throw "second";
      },
    );

    await expect(
      aggregateScheduler.initializeUninitializedResourcesParallel(),
    ).rejects.toMatchObject({
      name: "AggregateError",
      errors: expect.any(Array),
      cause: expect.any(Error),
    });

    const blockedDependency = defineResource({ id: "blocked-dependency" });
    const blockedConsumer = defineResource({
      id: "blocked-consumer",
      dependencies: { blockedDependency },
    });
    const blockedStore = createSchedulerStore();
    blockedStore.resources.set(root.id, {
      resource: root,
      isInitialized: true,
    });
    blockedStore.resources.set(blockedDependency.id, {
      resource: blockedDependency,
      isInitialized: false,
    });
    blockedStore.resources.set(blockedConsumer.id, {
      resource: blockedConsumer,
      isInitialized: false,
    });
    const blockedScheduler = new ResourceScheduler(
      blockedStore as any,
      async () => undefined,
    );

    await expect(
      blockedScheduler.initializeUninitializedResourcesParallel(
        new Set([blockedConsumer.id]),
      ),
    ).rejects.toThrow(/parallel initialization/i);
  });

  it("covers traversal helpers for nested dependencies, tag expansion, and visit guards", () => {
    const store = createSchedulerStore();
    const scheduler = new ResourceScheduler(
      store as any,
      async () => undefined,
    ) as unknown as {
      collectResourceDependency: (
        resource: unknown,
        optionalDependency: boolean,
        state: any,
        options: { includeTransitiveResourceDependencies: boolean },
      ) => void;
      getRegisteredDependencies: (value: unknown) => unknown;
      getDefinitionVisitKey: (value: unknown) => string;
      traverseDependency: (
        dependency: unknown,
        consumerId: string,
        state: any,
        options: { includeTransitiveResourceDependencies: boolean },
      ) => void;
      expandTagDependency: (
        tag: unknown,
        consumerId: string,
        state: any,
        options: { includeTransitiveResourceDependencies: boolean },
      ) => void;
    };

    const nestedResource = defineResource({ id: "nested-resource" });
    const nestedTask = defineTask({
      id: "nested-task",
      dependencies: { nestedResource },
      async run() {
        return "ok";
      },
    });
    const nestedHookEvent = defineTag({ id: "nested-hook-event-tag" });
    const nestedHook = defineHook({
      id: "nested-hook",
      on: "*",
      dependencies: { nestedResource },
      async run() {},
    });
    const nestedTaskMiddleware = defineTaskMiddleware({
      id: "nested-task-middleware",
      dependencies: { nestedResource },
      async run({ next, task }) {
        return next(task.input);
      },
    });
    const nestedResourceMiddleware = defineResourceMiddleware({
      id: "nested-resource-middleware",
      dependencies: { nestedResource },
      async run({ next }) {
        return next();
      },
    });
    const nestedTag = defineTag({ id: "nested-tag" });

    store.resources.set(nestedResource.id, {
      resource: nestedResource,
      isInitialized: true,
    });
    store.tasks.set(nestedTask.id, { task: nestedTask });
    store.hooks.set(nestedHook.id, { hook: nestedHook });
    store.taskMiddlewares.set(nestedTaskMiddleware.id, {
      middleware: nestedTaskMiddleware,
    });
    store.resourceMiddlewares.set(nestedResourceMiddleware.id, {
      middleware: nestedResourceMiddleware,
    });
    store.tags.set(nestedTag.id, nestedTag);
    store.tags.set(nestedHookEvent.id, nestedHookEvent);

    store.getTagAccessor.mockReturnValue({
      resources: [{ definition: nestedResource, config: undefined }],
      tasks: [{ definition: nestedTask, config: undefined }],
      hooks: [{ definition: nestedHook, config: undefined }],
      taskMiddlewares: [
        { definition: nestedTaskMiddleware, config: undefined },
      ],
      resourceMiddlewares: [
        { definition: nestedResourceMiddleware, config: undefined },
      ],
    });

    const state = {
      resourceIds: new Set<string>(),
      visitedDefinitions: new Set<string>(),
      visitedTagLookups: new Set<string>(),
    };
    const options = { includeTransitiveResourceDependencies: true };

    expect(scheduler.getRegisteredDependencies(nestedTask)).toEqual(
      nestedTask.dependencies,
    );
    expect(scheduler.getRegisteredDependencies(nestedHook)).toEqual(
      nestedHook.dependencies,
    );
    expect(scheduler.getRegisteredDependencies(nestedTaskMiddleware)).toEqual(
      nestedTaskMiddleware.dependencies,
    );
    expect(
      scheduler.getRegisteredDependencies(nestedResourceMiddleware),
    ).toEqual(nestedResourceMiddleware.dependencies);
    expect(scheduler.getRegisteredDependencies({ bad: true })).toBeUndefined();

    expect(scheduler.getDefinitionVisitKey(nestedTask)).toContain("task:");
    expect(scheduler.getDefinitionVisitKey(nestedHook)).toContain("hook:");
    expect(scheduler.getDefinitionVisitKey(nestedTaskMiddleware)).toContain(
      "taskMiddleware:",
    );
    expect(scheduler.getDefinitionVisitKey(nestedResourceMiddleware)).toContain(
      "resourceMiddleware:",
    );

    scheduler.traverseDependency(nestedTask, "consumer", state, options);
    scheduler.traverseDependency(nestedTask, "consumer", state, options);
    scheduler.traverseDependency(nestedHook, "consumer", state, options);
    scheduler.traverseDependency(
      nestedTaskMiddleware,
      "consumer",
      state,
      options,
    );
    scheduler.traverseDependency(
      nestedResourceMiddleware,
      "consumer",
      state,
      options,
    );
    scheduler.traverseDependency(
      nestedTag.startup(),
      "consumer",
      state,
      options,
    );
    scheduler.traverseDependency(nestedTag, "consumer", state, options);
    scheduler.expandTagDependency(nestedTag, "consumer", state, options);
    scheduler.expandTagDependency(nestedTag, "consumer", state, options);

    const missingResource = defineResource({ id: "missing-resource" });
    scheduler.collectResourceDependency(missingResource, true, state, options);
    scheduler.collectResourceDependency(missingResource, false, state, options);
    scheduler.collectResourceDependency(nestedResource, false, state, {
      includeTransitiveResourceDependencies: false,
    });
    state.visitedDefinitions.add(`resource:${nestedResource.id}`);
    scheduler.collectResourceDependency(nestedResource, false, state, options);

    expect(state.resourceIds.has(missingResource.id)).toBe(true);
    expect(store.getTagAccessor).toHaveBeenCalled();
  });
});
