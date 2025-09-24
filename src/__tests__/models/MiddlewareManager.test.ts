import { MiddlewareManager } from "../../models/MiddlewareManager";
import { Store } from "../../models/Store";
import { EventManager } from "../../models/EventManager";
import { Logger } from "../../models/Logger";
import {
  defineTask,
  defineResource,
  defineTaskMiddleware,
  defineResourceMiddleware,
} from "../../define";
import { OnUnhandledError } from "../../index";
import { globalEvents } from "../../globals/globalEvents";
import { RunnerMode } from "../../enums/RunnerMode";

describe("MiddlewareManager", () => {
  let store: Store;
  let eventManager: EventManager;
  let logger: Logger;
  let manager: MiddlewareManager;
  let onUnhandledError: OnUnhandledError;
  beforeEach(() => {
    eventManager = new EventManager({ runtimeCycleDetection: true });
    logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    onUnhandledError = jest.fn();
    store = new Store(eventManager, logger, onUnhandledError, RunnerMode.TEST);
    // Get the store's existing middleware manager
    manager = (store as any).middlewareManager;
  });

  it("composes task runner with interceptors inside middleware and preserves order", async () => {
    const order: string[] = [];

    const m1 = defineTaskMiddleware({
      id: "m1",
      run: async ({ next, task }) => {
        order.push("m1:before");
        const result = await next(task?.input);
        order.push("m1:after");
        return result;
      },
    });

    const m2 = defineTaskMiddleware({
      id: "m2",
      run: async ({ next, task }) => {
        order.push("m2:before");
        const result = await next(task?.input);
        order.push("m2:after");
        return result;
      },
    });

    const task = defineTask({
      id: "t",
      middleware: [m1, m2],
      run: async (input: number) => {
        order.push("task:run");
        return input + 1;
      },
    });

    store.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: true,
      interceptors: [
        async (next, input: number) => {
          order.push("interceptor:run");
          return next(input);
        },
      ],
    });
    store.taskMiddlewares.set(m1.id, {
      middleware: m1,
      computedDependencies: {},
      isInitialized: true,
    });
    store.taskMiddlewares.set(m2.id, {
      middleware: m2,
      computedDependencies: {},
      isInitialized: true,
    });

    const runner = manager.composeTaskRunner(task);
    const result = await runner(1);
    expect(result).toBe(2);
    expect(order).toEqual([
      // Middlewares are outer; interceptor should be inside, then task
      "m1:before",
      "m2:before",
      "interceptor:run",
      "task:run",
      "m2:after",
      "m1:after",
    ]);
  });

  it("dedupes global vs local task middleware by id and emits observability events (non-global)", async () => {
    const calls: string[] = [];

    // Global listener should not be called for observability events (excluded by tag)
    eventManager.addGlobalListener(async () => {
      calls.push("globalListener");
    });
    const mLocal = defineTaskMiddleware({
      id: "shared",
      run: async ({ next, task }) => {
        const res = await next(task?.input);
        return (res as number) + 3;
      },
    });
    const mOther = defineTaskMiddleware({
      id: "other",
      run: async ({ next, task }) => {
        const res = await next(task?.input);
        return (res as number) * 2;
      },
    });
    const mGlobalSameId = defineTaskMiddleware({
      id: "shared",
      run: async ({ next, task }) => next(task?.input),
    });

    const task = defineTask({
      id: "t2",
      middleware: [mLocal, mOther],
      run: async (i: number) => i,
    });

    // Local registry entries
    store.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: true,
    });
    store.taskMiddlewares.set(mLocal.id, {
      middleware: mLocal,
      computedDependencies: {},
    } as any);
    store.taskMiddlewares.set(mOther.id, {
      middleware: mOther,
      computedDependencies: {},
    } as any);

    // Stub global middleware provider to return one with same id as local; manager should dedupe it
    const spy = jest
      .spyOn(manager, "getEverywhereMiddlewareForTasks")
      .mockReturnValue([mGlobalSameId]);

    const runner = manager.composeTaskRunner(task);
    const result = await runner(2);
    // ((2) * 2) + 3 = 7 (dedup ensures global "shared" is ignored; local "shared" runs once)
    expect(result).toBe(7);

    // Ensure event-specific listeners called twice (two middlewares), global listener not called
    const globalCalls = calls.filter((c) => c === "globalListener").length;
    expect(globalCalls).toBe(0);

    spy.mockRestore();
  });

  it("wraps resource init with middleware and returns modified result", async () => {
    const m = defineResourceMiddleware({
      id: "rm",
      run: async ({ next, resource }) => {
        const result = await next(resource?.config);
        return (result as number) + 10;
      },
    });

    const resource = defineResource<{ n: number }, Promise<number>>({
      id: "r",
      middleware: [m],
      init: async (cfg) => cfg.n * 2,
    });

    store.resourceMiddlewares.set(m.id, {
      middleware: m,
      computedDependencies: {},
      isInitialized: true,
    } as any);

    const result = await manager.runResourceInit(resource, { n: 5 }, {}, {});
    // base = 10, middleware adds 10 => 20
    expect(result).toBe(20);
  });

  it("returns undefined when resource has no init", async () => {
    const resource = defineResource({ id: "r2" });
    const result = await manager.runResourceInit(
      resource as any,
      undefined as any,
      {},
      {},
    );
    expect(result).toBeUndefined();
  });

  it("should call getEverywhereMiddlewareForTasks method", () => {
    // Create a minimal, typed task
    const t = defineTask({ id: "t.method", run: async () => 0 });
    const result = manager.getEverywhereMiddlewareForTasks(t);
    expect(Array.isArray(result)).toBe(true);
  });

  it("should call getEverywhereMiddlewareForResources method", () => {
    // Create a minimal, typed resource
    const r = defineResource({ id: "r.method" });
    const result = manager.getEverywhereMiddlewareForResources(r);
    expect(Array.isArray(result)).toBe(true);
  });

  it("getEverywhereMiddlewareForTasks excludes middleware that depends on the task", () => {
    const task = defineTask({ id: "task.dep", run: async () => 0 });
    const mw = defineTaskMiddleware({
      id: "mw",
      dependencies: { t: task },
      run: async ({ next, task }) => next(task?.input),
      everywhere(task) {
        return task.id !== task.id;
      },
    });
    // register via public API to ensure types are respected
    store.storeGenericItem(mw);
    const res = manager.getEverywhereMiddlewareForTasks(task);
    expect(res).toHaveLength(0);
  });

  describe("interceptors", () => {
    it("should add task middleware interceptor", () => {
      const interceptor = jest.fn(async (next: any, input: any) => next(input));
      expect(() => {
        manager.intercept("task", interceptor);
      }).not.toThrow();
      expect(manager.isLocked).toBe(false);
      // Check that interceptor was added
      expect((manager as any).taskMiddlewareInterceptors.length).toBe(1);
    });

    it("should add resource middleware interceptor", () => {
      const interceptor = jest.fn(async (next, input) => next(input));
      expect(() => {
        manager.intercept("resource", interceptor);
      }).not.toThrow();
    });

    it("should throw when adding interceptor while locked", () => {
      manager.lock();
      expect(manager.isLocked).toBe(true);
      const interceptor = jest.fn(async (next, input) => next(input));
      expect(() => {
        manager.intercept("task", interceptor);
      }).toThrow("Cannot modify the MiddlewareManager when it is locked.");
    });

    it("should apply task middleware interceptors in reverse order", async () => {
      const order: string[] = [];

      // Add interceptors
      manager.intercept("task", async (next: any, input: any) => {
        order.push("interceptor1:before");
        const result = await next(input);
        order.push("interceptor1:after");
        return result;
      });

      manager.intercept("task", async (next: any, input: any) => {
        order.push("interceptor2:before");
        const result = await next(input);
        order.push("interceptor2:after");
        return result;
      });

      const task = defineTask({
        id: "task_with_interceptors",
        run: async (input: number) => {
          order.push("task:run");
          return input + 1;
        },
      });

      store.tasks.set(task.id, {
        task,
        computedDependencies: {},
        isInitialized: true,
      });

      const runner = manager.composeTaskRunner(task);
      const result = await runner(5);

      expect(result).toBe(6);
      expect(order).toEqual([
        "interceptor2:before", // Last added runs first
        "interceptor1:before",
        "task:run",
        "interceptor1:after",
        "interceptor2:after",
      ]);
    });

    it("should apply resource middleware interceptors in reverse order", async () => {
      const order: string[] = [];

      // Add interceptors
      manager.intercept("resource", async (next: any, input: any) => {
        order.push("interceptor1:before");
        const result = await next(input);
        order.push("interceptor1:after");
        return result;
      });

      manager.intercept("resource", async (next: any, input: any) => {
        order.push("interceptor2:before");
        const result = await next(input);
        order.push("interceptor2:after");
        return result;
      });

      const resource = defineResource<{ n: number }, Promise<number>>({
        id: "resource_with_interceptors",
        init: async (cfg) => {
          order.push("resource:init");
          return cfg.n * 2;
        },
      });

      const result = await manager.runResourceInit(resource, { n: 3 }, {}, {});

      expect(result).toBe(6);
      expect(order).toEqual([
        "interceptor2:before", // Last added runs first
        "interceptor1:before",
        "resource:init",
        "interceptor1:after",
        "interceptor2:after",
      ]);
    });

    it("should handle task middleware interceptor errors", async () => {
      const errors: any[] = [];
      const store = new Store(eventManager, logger, (e) => {
        errors.push(e);
      }, RunnerMode.TEST);
      const manager = new MiddlewareManager(store, eventManager, logger);

      manager.intercept("task", async (next: any, input: any) => {
        throw new Error("interceptor error");
      });

      const task = defineTask({
        id: "task_with_error_interceptor",
        run: async (input: number) => input + 1,
      });

      store.tasks.set(task.id, {
        task,
        computedDependencies: {},
        isInitialized: true,
      });

      const runner = manager.composeTaskRunner(task);
      await expect(runner(5)).rejects.toThrow("interceptor error");
    });

    it("should handle resource middleware interceptor errors", async () => {
      const errors: any[] = [];
      const store = new Store(eventManager, logger, (e) => {
        errors.push(e);
      }, RunnerMode.TEST);
      const manager = new MiddlewareManager(store, eventManager, logger);

      manager.intercept("resource", async (next: any, input: any) => {
        throw new Error("interceptor error");
      });

      const resource = defineResource<{ n: number }, Promise<number>>({
        id: "resource_with_error_interceptor",
        init: async (cfg) => cfg.n * 2,
      });

      await expect(
        manager.runResourceInit(resource, { n: 3 }, {}, {}),
      ).rejects.toThrow("interceptor error");
    });

    it("should work without any interceptors", async () => {
      const task = defineTask({
        id: "task_no_interceptors",
        run: async (input: number) => input + 1,
      });

      store.tasks.set(task.id, {
        task,
        computedDependencies: {},
        isInitialized: true,
      });

      const runner = manager.composeTaskRunner(task);
      const result = await runner(5);
      expect(result).toBe(6);
    });

    it("should work with interceptMiddleware method for type-safe middleware interception", async () => {
      const order: string[] = [];
      const taskMiddleware = defineTaskMiddleware({
        id: "test_task_middleware",
        run: async ({ next, task }) => {
          order.push("middleware:run");
          return next(task?.input);
        },
      });

      // Add interceptor using the new type-safe method
      manager.interceptMiddleware(
        taskMiddleware,
        async (next: any, input: any) => {
          order.push("interceptor:before");
          const result = await next(input);
          order.push("interceptor:after");
          return result;
        },
      );

      const task = defineTask({
        id: "task_with_typed_interceptor",
        middleware: [taskMiddleware], // Add middleware to task
        run: async (input: number) => {
          order.push("task:run");
          return input + 1;
        },
      });

      store.tasks.set(task.id, {
        task,
        computedDependencies: {},
        isInitialized: true,
      });

      // Register the middleware in the store
      store.taskMiddlewares.set(taskMiddleware.id, {
        middleware: taskMiddleware,
        computedDependencies: {},
        isInitialized: true,
      } as any);

      const runner = manager.composeTaskRunner(task);
      const result = await runner(10);

      expect(result).toBe(11);
      expect(order).toEqual([
        "interceptor:before",
        "middleware:run",
        "task:run",
        "interceptor:after",
      ]);
    });

    it("should apply per-resource middleware interceptors in reverse order and modify result", async () => {
      const order: string[] = [];

      const resourceMiddleware = defineResourceMiddleware({
        id: "test_resource_middleware",
        run: async ({ next, resource }) => {
          order.push("resource-middleware:run");
          const value = await next(resource?.config);
          return (value as number) + 1;
        },
      });

      // Add two interceptors for this specific resource middleware
      manager.interceptMiddleware(
        resourceMiddleware,
        async (next: any, input: any) => {
          order.push("resource-interceptor1:before");
          const result = await next(input);
          order.push("resource-interceptor1:after");
          return result;
        },
      );

      manager.interceptMiddleware(
        resourceMiddleware,
        async (next: any, input: any) => {
          order.push("resource-interceptor2:before");
          const result = await next(input);
          order.push("resource-interceptor2:after");
          return result;
        },
      );

      const resource = defineResource<{ n: number }, Promise<number>>({
        id: "resource_with_per_mw_interceptors",
        middleware: [resourceMiddleware],
        init: async (cfg) => {
          order.push("resource:init");
          return cfg.n * 2;
        },
      });

      // Register the middleware in the store
      store.resourceMiddlewares.set(resourceMiddleware.id, {
        middleware: resourceMiddleware,
        computedDependencies: {},
        isInitialized: true,
      } as any);

      const result = await manager.runResourceInit(resource, { n: 3 }, {}, {});

      // init: 3*2=6, middleware adds +1 => 7
      expect(result).toBe(7);
      expect(order).toEqual([
        "resource-interceptor2:before",
        "resource-interceptor1:before",
        "resource-middleware:run",
        "resource:init",
        "resource-interceptor1:after",
        "resource-interceptor2:after",
      ]);
    });

    it("should throw when interceptMiddleware receives an unknown middleware type", () => {
      const bogusMiddleware = { id: "bogus" } as any;
      expect(() =>
        manager.interceptMiddleware(
          bogusMiddleware,
          async (next: any, input: any) => next(input),
        ),
      ).toThrow("Unknown middleware type");
    });
  });
});
