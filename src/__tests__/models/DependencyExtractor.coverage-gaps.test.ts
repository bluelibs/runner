import {
  defineEvent,
  defineHook,
  defineResource,
  defineResourceMiddleware,
  defineTag,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { globalResources } from "../../globals/globalResources";
import { Logger } from "../../models/Logger";
import { DependencyExtractor } from "../../models/dependency-processor/DependencyExtractor";
import { createTestFixture } from "../test-utils";

type ExtractorStore = {
  events: Map<string, any>;
  tasks: Map<string, any>;
  resources: Map<string, any>;
  tags: Map<string, any>;
  hooks: Map<string, any>;
  taskMiddlewares: Map<string, any>;
  resourceMiddlewares: Map<string, any>;
  isLocked: boolean;
  findIdByDefinition: (reference: unknown) => string;
  getTagAccessor: jest.Mock;
};

function createExtractorStore(): ExtractorStore {
  return {
    events: new Map<string, any>(),
    tasks: new Map<string, any>(),
    resources: new Map<string, any>(),
    tags: new Map<string, any>(),
    hooks: new Map<string, any>(),
    taskMiddlewares: new Map<string, any>(),
    resourceMiddlewares: new Map<string, any>(),
    isLocked: false,
    findIdByDefinition: (reference: unknown) => {
      if (typeof reference === "string") {
        return reference;
      }
      if (
        reference &&
        typeof reference === "object" &&
        "id" in reference &&
        typeof (reference as { id?: unknown }).id === "string"
      ) {
        return (reference as { id: string }).id;
      }
      return String(reference);
    },
    getTagAccessor: jest.fn(),
  };
}

describe("DependencyExtractor coverage gaps", () => {
  it("covers undefined dependency entries, optional/tag-startup extraction, and missing task/resource errors", async () => {
    const fixture = createTestFixture();
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    const logErrorSpy = jest.spyOn(logger, "error");
    const store = createExtractorStore();
    const eventManager = {
      emit: jest.fn(async () => undefined),
    };
    const taskRunner = {
      run: jest.fn(async () => "task-output"),
    };
    const extractor = new DependencyExtractor(
      store as any,
      eventManager as any,
      taskRunner as any,
      logger,
      async () => undefined,
    );

    const event = defineEvent<{ ok: boolean }>({
      id: "extractor-gap-event",
    });
    store.events.set(event.id, { event });

    const tag = defineTag({ id: "extractor-gap-tag" });
    store.tags.set(tag.id, tag);
    store.getTagAccessor.mockReturnValue({
      tasks: [],
      resources: [],
      events: [],
      hooks: [],
      taskMiddlewares: [],
      resourceMiddlewares: [],
      errors: [],
    });

    const missingTask = defineTask({
      id: "extractor-gap-missing-task",
      async run() {
        return "missing";
      },
    });
    const missingResource = defineResource({
      id: "extractor-gap-missing-resource",
    });

    await expect(
      extractor.extractDependencies(
        {
          skipped: undefined,
          missingTask,
        } as any,
        "extractor-gap-source",
      ),
    ).rejects.toThrow(/Task extractor-gap-missing-task/i);
    expect(logErrorSpy).toHaveBeenCalled();

    await expect(
      extractor.extractDependency(missingResource, "extractor-gap-source"),
    ).rejects.toThrow(/Resource extractor-gap-missing-resource/i);
    await expect(
      extractor.extractDependency(
        missingResource.optional(),
        "extractor-gap-source",
      ),
    ).resolves.toBeUndefined();

    const startupAccessor = await extractor.extractDependency(
      tag.startup(),
      "extractor-gap-source",
    );
    expect(startupAccessor).toEqual(
      expect.objectContaining({
        tasks: [],
        resources: [],
      }),
    );

    const emitEvent = await extractor.extractDependency(
      event,
      "extractor-gap-source",
    );
    await emitEvent({ ok: true });
    expect(eventManager.emit).toHaveBeenCalledWith(
      event,
      { ok: true },
      expect.any(Object),
      undefined,
    );
  });

  it("covers tag accessor caching, task runner caching, intercept guards, runtime resource values, and middleware-manager proxy branches", async () => {
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    const store = createExtractorStore();
    const taskRunner = {
      run: jest.fn(async () => "task-result"),
    };
    const extractor = new DependencyExtractor(
      store as any,
      { emit: jest.fn(async () => undefined) } as any,
      taskRunner as any,
      logger,
      async () => undefined,
    ) as unknown as {
      extractTagDependency: (tag: unknown, source: string) => Promise<any>;
      makeOwnerAwareMiddlewareManager: (
        value: unknown,
        ownerResourceId: string,
      ) => unknown;
      wrapResourceDependencies: (
        deps: Record<string, unknown>,
        extracted: Record<string, unknown>,
        ownerResourceId: string,
      ) => Record<string, unknown>;
      createRuntimeTaggedResourceMatch: (entry: any) => any;
    };

    const ownerResource = defineResource({
      id: "extractor-gap-owner-resource",
    });
    const taggedResource = defineResource({
      id: "extractor-gap-tagged-resource",
    });
    const taggedTask = defineTask({
      id: "extractor-gap-tagged-task",
      async run() {
        return "tagged";
      },
    });
    const taggedHook = defineHook({
      id: "extractor-gap-tagged-hook",
      on: "*",
      async run() {},
    });
    const taggedTaskMiddleware = defineTaskMiddleware({
      id: "extractor-gap-tagged-task-middleware",
      async run({ next, task }) {
        return next(task.input);
      },
    });
    const taggedResourceMiddleware = defineResourceMiddleware({
      id: "extractor-gap-tagged-resource-middleware",
      async run({ next }) {
        return next();
      },
    });
    const taggedEvent = defineEvent({
      id: "extractor-gap-tagged-event",
    });
    const taggedTag = defineTag({ id: "extractor-gap-tag" });

    store.tags.set(taggedTag.id, taggedTag);
    store.tasks.set(taggedTask.id, {
      task: taggedTask,
      computedDependencies: {},
      isInitialized: true,
      interceptors: [],
    });
    store.resources.set(ownerResource.id, {
      resource: ownerResource,
      isInitialized: true,
      value: "owner",
    });
    store.resources.set(taggedResource.id, {
      resource: taggedResource,
      isInitialized: false,
      value: undefined,
    });
    store.getTagAccessor.mockReturnValue({
      tasks: [{ definition: taggedTask, config: undefined }],
      resources: [{ definition: taggedResource, config: undefined }],
      events: [{ definition: taggedEvent, config: undefined }],
      hooks: [{ definition: taggedHook, config: undefined }],
      taskMiddlewares: [
        { definition: taggedTaskMiddleware, config: undefined },
      ],
      resourceMiddlewares: [
        { definition: taggedResourceMiddleware, config: undefined },
      ],
      errors: [
        { definition: { id: "extractor-gap-error" }, config: undefined },
      ],
    });

    const accessorWithOwner = await extractor.extractTagDependency(
      taggedTag,
      ownerResource.id,
    );
    const tasksFirstRead = accessorWithOwner.tasks;
    const tasksSecondRead = accessorWithOwner.tasks;
    expect(tasksFirstRead).toBe(tasksSecondRead);

    await tasksFirstRead[0].run({ payload: true });
    await tasksFirstRead[0].run({ payload: true });
    expect(taskRunner.run).toHaveBeenCalledTimes(2);

    tasksFirstRead[0].intercept(async ({ next, task }) => next(task.input));
    expect(tasksFirstRead[0].getInterceptingResourceIds()).toEqual([
      ownerResource.id,
    ]);

    store.isLocked = true;
    expect(() =>
      tasksFirstRead[0].intercept(async ({ next, task }) => next(task.input)),
    ).toThrow(/after the runtime has been locked/i);
    store.isLocked = false;

    const resources = accessorWithOwner.resources;
    expect(resources[0].value).toBeUndefined();
    store.resources.get(taggedResource.id)!.isInitialized = true;
    store.resources.get(taggedResource.id)!.value = { healthy: true };
    expect(resources[0].value).toEqual({ healthy: true });

    expect(accessorWithOwner.events).toHaveLength(1);
    expect(accessorWithOwner.hooks).toHaveLength(1);
    expect(accessorWithOwner.taskMiddlewares).toHaveLength(1);
    expect(accessorWithOwner.resourceMiddlewares).toHaveLength(1);
    expect(accessorWithOwner.errors).toHaveLength(1);

    const accessorWithoutOwner = await extractor.extractTagDependency(
      taggedTag,
      "extractor-gap-non-owner",
    );
    const plainTaggedTask = accessorWithoutOwner.tasks[0];
    expect("intercept" in plainTaggedTask).toBe(false);

    const middlewareManager = {
      interceptOwned: jest.fn(),
      interceptMiddlewareOwned: jest.fn(),
      ping() {
        return this;
      },
      value: 123,
    };
    const wrapped = extractor.wrapResourceDependencies(
      {
        middlewareManager: globalResources.middlewareManager,
      },
      {
        middlewareManager,
      },
      ownerResource.id,
    );
    const proxy = wrapped.middlewareManager as any;
    proxy.intercept("task", async (_ctx: unknown, input: any) =>
      input.next(input.task.input),
    );
    proxy.intercept("resource", async (_ctx: unknown, input: any) =>
      input.next(),
    );
    proxy.interceptMiddleware(
      taggedTaskMiddleware,
      async (_ctx: any, input: any) => input.next(input.task.input),
    );
    proxy.interceptMiddleware(
      taggedResourceMiddleware,
      async (_ctx: any, input: any) => input.next(),
    );
    expect(proxy.ping()).toBe(middlewareManager);
    expect(proxy.value).toBe(123);
    expect(middlewareManager.interceptOwned).toHaveBeenCalledTimes(2);
    expect(middlewareManager.interceptMiddlewareOwned).toHaveBeenCalledTimes(2);

    expect(
      extractor.makeOwnerAwareMiddlewareManager(null, ownerResource.id),
    ).toBeNull();
    const plainObject = { value: true };
    expect(
      extractor.makeOwnerAwareMiddlewareManager(plainObject, ownerResource.id),
    ).toBe(plainObject);

    const runtimeEntry = extractor.createRuntimeTaggedResourceMatch({
      definition: taggedResource,
      config: undefined,
    });
    store.resources.get(taggedResource.id)!.isInitialized = false;
    expect(runtimeEntry.value).toBeUndefined();
    store.resources.get(taggedResource.id)!.isInitialized = true;
    store.resources.get(taggedResource.id)!.value = "runtime-value";
    expect(runtimeEntry.value).toBe("runtime-value");
  });
});
