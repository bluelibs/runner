import { Store } from "../Store";
import { EventManager } from "../EventManager";
import {
  defineResource,
  defineTask,
  defineMiddleware,
  defineEvent,
} from "../define";
import { globalResources } from "../globalResources";

describe("Store", () => {
  let eventManager: EventManager;
  let store: Store;

  beforeEach(() => {
    eventManager = new EventManager();
    store = new Store(eventManager);
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
      "Cannot modify the Store when it is locked."
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
    const testMiddleware = defineMiddleware({
      id: "test.middleware",
      run: async ({ next }) => {
        return `Middleware: ${await next()}`;
      },
    });

    store.storeGenericItem(testMiddleware);

    expect(store.middlewares.has("test.middleware")).toBe(true);
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
      /already registered/i
    );
  });

  it("should throw an error if you're trying to initialize the store twice", () => {
    const rootResource = defineResource({
      id: "root",
      init: async () => "Root Value",
    });

    store.initializeStore(rootResource, {});

    expect(() => store.initializeStore(rootResource, {})).toThrow(
      /Store already initialized/i
    );
  });
});
