import { Store } from "../../models/Store";
import { EventManager } from "../../models/EventManager";
import {
  defineResource,
  defineTask,
  defineEvent,
  defineTag,
} from "../../define";
import { middleware } from "../../index";
import { Logger, OnUnhandledError, PrintStrategy } from "../../models";

describe("Store", () => {
  let eventManager: EventManager;
  let store: Store;
  let logger: Logger;
  let onUnhandledError: OnUnhandledError;

  beforeEach(() => {
    eventManager = new EventManager();
    logger = new Logger({
      printThreshold: "info",
      printStrategy: "pretty",
      bufferLogs: false,
    });
    onUnhandledError = jest.fn();
    store = new Store(eventManager, logger, onUnhandledError);
  });

  it("should initialize the store with a root resource", () => {
    const rootResource = defineResource({
      id: "root",
      init: async () => "Root Value",
    });

    store.initializeStore(rootResource, {});

    expect(store.root.resource).toBe(rootResource);
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
    const testMiddleware = middleware.task({
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

  it("getDependentNodes handles empty middleware and task middleware arrays (branches)", () => {
    const root = defineResource({ id: "root.dep.nodes", register: [] });
    store.initializeStore(root, {});
    // add a task with empty middleware
    const t = defineTask({
      id: "t.empty.mw",
      middleware: [],
      async run() {
        return 1;
      },
    });
    store.storeGenericItem(t);
    const nodes = store.getDependentNodes();
    expect(Array.isArray(nodes)).toBe(true);
  });

  it("should call storeEventsForAllTasks method", () => {
    // Test storeEventsForAllTasks method (line 165)
    expect(() => store.storeEventsForAllTRM()).not.toThrow();
  });

  it("should call getDependentNodes method", () => {
    // Test getDependentNodes method (line 169)
    const result = store.getDependentNodes();
    expect(Array.isArray(result)).toBe(true);
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
});
