import { Store } from "../../models/Store";
import { EventManager } from "../../models/EventManager";
import {
  defineResource,
  defineTask,
  defineEvent,
  defineTag,
  defineTaskMiddleware,
} from "../../define";
import { run } from "../../run";
import { Logger, MiddlewareManager, OnUnhandledError } from "../../models";
import { RunnerMode } from "../../types/runner";
import { createTestFixture } from "../test-utils";

describe("Store", () => {
  let eventManager: EventManager;
  let store: Store;
  let logger: Logger;
  let onUnhandledError: OnUnhandledError;

  beforeEach(() => {
    const fixture = createTestFixture();
    ({ eventManager, logger, onUnhandledError, store } = fixture);
    store.setTaskRunner(fixture.createTaskRunner());
  });

  it("should expose some helpers", () => {
    expect(store.getMiddlewareManager()).toBeInstanceOf(MiddlewareManager);
  });

  it("should ignore duplicate calls to recordResourceInitialized", () => {
    store.recordResourceInitialized("dup");
    store.recordResourceInitialized("dup");
    store.recordResourceInitialized("other");
    store.recordResourceInitialized("dup");
  });

  it("should initialize the store with a root resource", () => {
    const rootResource = defineResource({
      id: "root",
      init: async () => "Root Value",
    });

    store.initializeStore(rootResource, {});

    expect(store.root.resource.id).toBe(rootResource.id);
    expect(store.root.resource).not.toBe(rootResource);
    expect(store.resources.has("root")).toBe(true);
  });

  it("should lock the store and prevent modifications", () => {
    store.lock();
    expect(store.isLocked).toBe(true);

    expect(() => store.checkLock()).toThrow(
      "Cannot modify the Store when it is locked.",
    );
  });

  it("should store a task and retrieve it", () => {
    const testTask = defineTask({
      id: "test.task",
      run: async () => "Task executed",
    });

    store.storeGenericItem(testTask);

    expect(store.tasks.has("test.task")).toBe(true);
  });

  it("should store a resource and retrieve it", () => {
    const testResource = defineResource({
      id: "test.resource",
      init: async () => "Resource Value",
    });

    store.storeGenericItem(testResource);

    expect(store.resources.has("test.resource")).toBe(true);
  });

  it("should store a middleware and retrieve it", () => {
    const testMiddleware = defineTaskMiddleware({
      id: "test.middleware",
      run: async ({ next }) => {
        return `Middleware: ${await next()}`;
      },
    });

    store.storeGenericItem(testMiddleware);
    expect(store.taskMiddlewares.has("test.middleware")).toBe(true);
  });

  it("should store an event and retrieve it", () => {
    const testEvent = defineEvent({ id: "test.event" });

    store.storeGenericItem(testEvent);

    expect(store.events.has("test.event")).toBe(true);
  });

  it("should dispose of resources correctly", async () => {
    const disposeFn = jest.fn(async (...args: any[]) => {});
    const testResource = defineResource({
      id: "test.resource",
      dispose: disposeFn,
      init: async () => "Resource Value",
    });

    store.storeGenericItem(testResource);

    // Simulate resource initialization
    store.resources.get("test.resource")!.value = "Resource Value";
    store.resources.get("test.resource")!.isInitialized = true;

    await store.dispose();

    expect(disposeFn).toHaveBeenCalled();
  });

  it("should dispose dependents before their dependencies", async () => {
    const callOrder: string[] = [];

    const dependency = defineResource({
      id: "dispose.order.dep",
      dispose: async () => {
        callOrder.push("dep");
      },
    });

    const dependent = defineResource({
      id: "dispose.order.dependent",
      dependencies: { dependency },
      dispose: async () => {
        callOrder.push("dependent");
      },
    });

    // Register dependency first to ensure insertion order is not relied on.
    store.storeGenericItem(dependency);
    store.storeGenericItem(dependent);

    store.resources.get(dependency.id)!.isInitialized = true;
    store.resources.get(dependent.id)!.isInitialized = true;

    await store.dispose();
    expect(callOrder).toEqual(["dependent", "dep"]);
  });

  it("should handle optional resource dependencies when ordering disposal", async () => {
    const callOrder: string[] = [];

    const dependency = defineResource({
      id: "dispose.order.optional.dep",
      dispose: async () => {
        callOrder.push("dep");
      },
    });

    const dependent = defineResource({
      id: "dispose.order.optional.dependent",
      dependencies: { maybeDep: dependency.optional() },
      dispose: async () => {
        callOrder.push("dependent");
      },
    });

    store.storeGenericItem(dependency);
    store.storeGenericItem(dependent);

    store.resources.get(dependency.id)!.isInitialized = true;
    store.resources.get(dependent.id)!.isInitialized = true;

    await store.dispose();
    expect(callOrder).toEqual(["dependent", "dep"]);
  });

  it("should dispose in reverse init order when init order is tracked", async () => {
    const callOrder: string[] = [];

    const dependency = defineResource({
      id: "dispose.initOrder.dep",
      async init() {
        return "dep";
      },
      dispose: async () => {
        callOrder.push("dep");
      },
    });

    const app = defineResource({
      id: "dispose.initOrder.app",
      register: [dependency],
      dependencies: { dependency },
      async init() {
        return "app";
      },
      dispose: async () => {
        callOrder.push("app");
      },
    });

    const result = await run(app, { mode: RunnerMode.TEST });
    await result.dispose();
    expect(callOrder).toEqual(["app", "dep"]);
  });

  it("should ignore non-object dependencies when ordering disposal", async () => {
    const disposeFn = jest.fn();
    const weirdDepsResource = defineResource({
      id: "dispose.order.weird.deps",
      dependencies: (() => "not-an-object") as any,
      dispose: async () => {
        disposeFn();
      },
    });

    store.storeGenericItem(weirdDepsResource);
    store.resources.get(weirdDepsResource.id)!.isInitialized = true;

    await store.dispose();
    expect(disposeFn).toHaveBeenCalledTimes(1);
  });

  it("should not throw if a dependency resource is not registered during disposal ordering", async () => {
    const disposeFn = jest.fn();
    const missing = defineResource({
      id: "dispose.order.missing.dep",
    });
    const dependent = defineResource({
      id: "dispose.order.missing.dependent",
      dependencies: { missing },
      dispose: async () => {
        disposeFn();
      },
    });

    store.storeGenericItem(dependent);
    store.resources.get(dependent.id)!.isInitialized = true;

    await store.dispose();
    expect(disposeFn).toHaveBeenCalledTimes(1);
  });

  it("should fall back to insertion order LIFO when a cycle is detected during disposal ordering", async () => {
    const callOrder: string[] = [];

    const aDeps: any = {};
    const bDeps: any = {};
    const a = defineResource({
      id: "dispose.order.cycle.a",
      dependencies: aDeps,
      dispose: async () => {
        callOrder.push("a");
      },
    });
    const b = defineResource({
      id: "dispose.order.cycle.b",
      dependencies: bDeps,
      dispose: async () => {
        callOrder.push("b");
      },
    });

    aDeps.b = b;
    bDeps.a = a;

    store.storeGenericItem(a);
    store.storeGenericItem(b);
    store.resources.get(a.id)!.isInitialized = true;
    store.resources.get(b.id)!.isInitialized = true;

    await store.dispose();
    expect(callOrder).toEqual(["b", "a"]);
  });

  it("should throw an error for duplicate registration", () => {
    const testTask = defineTask({
      id: "duplicate.task",
      run: async () => "Task executed",
    });

    store.storeGenericItem(testTask);

    expect(() => store.storeGenericItem(testTask)).toThrow(
      /already registered/i,
    );
  });

  it("should throw an error if you're trying to initialize the store twice", () => {
    const rootResource = defineResource({
      id: "root",
      init: async () => "Root Value",
    });

    store.initializeStore(rootResource, {});

    expect(() => store.initializeStore(rootResource, {})).toThrow(
      /Store already initialized/i,
    );
  });

  it("should access overrides and overrideRequests getters", () => {
    // Test the overrides getter (line 56)
    const overrides = store.overrides;
    expect(overrides).toBeDefined();
    expect(overrides instanceof Map).toBe(true);

    // Test the overrideRequests getter (line 57)
    const overrideRequests = store.overrideRequests;
    expect(overrideRequests).toBeDefined();
    expect(overrideRequests instanceof Set).toBe(true);
  });

  it("should call processOverrides method", () => {
    // Test processOverrides method (line 149)
    expect(() => store.processOverrides()).not.toThrow();
  });

  it("should call getTasksWithTag method", () => {
    const tag = defineTag({
      id: "tags.test",
    });
    const taskTest = defineTask({
      id: "task.test",
      tags: [tag],
      async run() {
        return "OK";
      },
    });
    const unfindableTask = defineTask({
      id: "task.unfindable",
      run: async () => 1,
    });
    const rootResource = defineResource({
      id: "root",
      register: [taskTest, unfindableTask, tag],
      init: async () => "Root Value",
    });

    store.initializeStore(rootResource, {});
    const result = store.getTasksWithTag(tag);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    const result2 = store.getTasksWithTag("tags.test");
    expect(result2).toHaveLength(1);
  });

  it("should call getResourcesWithTag method", () => {
    const tag = defineTag({
      id: "tags.test",
    });
    const resourceTest = defineResource({
      id: "resource.test",
      tags: [tag],
    });

    const unfindableResource = defineResource({
      id: "resource.unfindable",
      init: async () => 1,
    });
    const rootResource = defineResource({
      id: "root",
      register: [resourceTest, unfindableResource, tag],
      init: async () => "Root Value",
    });

    store.initializeStore(rootResource, {});
    const result = store.getResourcesWithTag(tag);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    const result2 = store.getResourcesWithTag("tags.test");
    expect(result2).toHaveLength(1);
  });

  it("should discover tasks and resources by a contract tag at runtime", async () => {
    const contractTag = defineTag<void, { tenantId: string }, { ok: boolean }>({
      id: "tags.contract",
    });

    const taskWithContractTag = defineTask({
      id: "task.contract",
      tags: [contractTag],
      run: async (input) => ({ ok: input.tenantId.length > 0 }),
    });

    const resourceWithContractTag = defineResource({
      id: "resource.contract",
      tags: [contractTag],
      init: async (config) => ({ ok: config.tenantId.length > 0 }),
    });

    const rootResource = defineResource({
      id: "root",
      register: [contractTag, taskWithContractTag, resourceWithContractTag],
      init: async () => "Root Value",
    });

    store.initializeStore(rootResource, {});

    const tasks = store.getTasksWithTag(contractTag);
    const resources = store.getResourcesWithTag(contractTag);

    expect(tasks).toHaveLength(1);
    expect(resources).toHaveLength(1);

    const firstTask = tasks[0]!;
    const firstResource = resources[0]!;
    if (!firstTask || !firstResource || !firstResource.init) {
      throw new Error("Expected one tagged task and one tagged resource");
    }

    await expect(
      firstTask.run({ tenantId: "acme" } as any, {} as any),
    ).resolves.toEqual({
      ok: true,
    });
    await expect(
      firstResource.init({ tenantId: "acme" } as any, {} as any, {} as any),
    ).resolves.toEqual({
      ok: true,
    });
  });
});
