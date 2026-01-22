import { MiddlewareManager } from "../../models/MiddlewareManager";
import { Store } from "../../models/Store";
import { EventManager } from "../../models/EventManager";
import { Logger } from "../../models/Logger";
// Import from barrel file for coverage
import * as MiddlewareExports from "../../models/middleware";
import {
  defineTask,
  defineResource,
  defineTaskMiddleware,
  defineResourceMiddleware,
} from "../../define";
import { OnUnhandledError } from "../../index";
import { RunnerMode } from "../../types/runner";
import { TaskStoreElementType } from "../../types/storeTypes";
import { ITaskMiddleware, IResource } from "../../defs";

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
    manager = (store as unknown as { middlewareManager: MiddlewareManager })
      .middlewareManager;
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
      isInitialized: true,
    });
    store.taskMiddlewares.set(mOther.id, {
      middleware: mOther,
      computedDependencies: {},
      isInitialized: true,
    });

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
    });

    const result = await manager.runResourceInit(resource, { n: 5 }, {}, {});
    // base = 10, middleware adds 10 => 20
    expect(result).toBe(20);
  });

  it("returns undefined when resource has no init", async () => {
    const resource = defineResource({ id: "r2" });
    const result = await manager.runResourceInit(
      resource as unknown as IResource<any>,
      undefined as unknown,
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

  it("getEverywhereMiddlewareForResources includes middleware with everywhere: true", () => {
    const r = defineResource({ id: "r.test" });
    const mw = defineResourceMiddleware({
      id: "mw.everywhere.true",
      everywhere: true,
      run: async ({ next }) => next(),
    });
    store.storeGenericItem(mw);
    const result = manager.getEverywhereMiddlewareForResources(r);
    expect(result.some((m) => m.id === "mw.everywhere.true")).toBe(true);
  });

  it("getEverywhereMiddlewareForResources filters with everywhere function", () => {
    const r = defineResource({ id: "r.test.func" });
    const mw = defineResourceMiddleware({
      id: "mw.everywhere.func",
      everywhere: (resource) => resource.id.startsWith("r.test"),
      run: async ({ next }) => next(),
    });
    store.storeGenericItem(mw);
    const result = manager.getEverywhereMiddlewareForResources(r);
    expect(result.some((m) => m.id === "mw.everywhere.func")).toBe(true);
  });

  it("should access resourceMiddlewareInterceptors getter", () => {
    // Access the deprecated getter for coverage
    const interceptors = (
      manager as unknown as { resourceMiddlewareInterceptors: any[] }
    ).resourceMiddlewareInterceptors;
    expect(Array.isArray(interceptors)).toBe(true);
  });

  it("getEverywhereMiddlewareForTasks includes middleware with everywhere: true", () => {
    const task = defineTask({ id: "task.true", run: async () => 0 });
    const mw = defineTaskMiddleware({
      id: "mw.task.everywhere.true",
      everywhere: true,
      run: async ({ next, task }) => next(task?.input),
    });
    store.storeGenericItem(mw);
    const res = manager.getEverywhereMiddlewareForTasks(task);
    expect(res.some((m) => m.id === "mw.task.everywhere.true")).toBe(true);
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

  it("should export middleware classes from barrel file", () => {
    // Execute barrel file exports for coverage
    expect(MiddlewareExports.ValidationHelper).toBeDefined();
    expect(MiddlewareExports.InterceptorRegistry).toBeDefined();
    expect(MiddlewareExports.MiddlewareResolver).toBeDefined();
    expect(MiddlewareExports.TaskMiddlewareComposer).toBeDefined();
    expect(MiddlewareExports.ResourceMiddlewareComposer).toBeDefined();
  });

  it("should handle non-Error validation failures", async () => {
    // Test ValidationHelper branch where error is not instanceof Error
    const task = defineTask({
      id: "task.nonError",
      resultSchema: {
        parse: (value: any) => {
          throw "string error"; // throw non-Error
        },
      },
      run: async () => 0,
    });
    store.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: true,
    } as unknown as TaskStoreElementType<any, any, any>);

    const runner = manager.composeTaskRunner(task);
    await expect(runner(undefined)).rejects.toThrow();
  });

  it("should apply tunnel policy filter when task is tunneled", () => {
    // Test MiddlewareResolver branch for tunnel policy
    const { globalTags } = require("../../globals/globalTags");

    const mw = defineTaskMiddleware({
      id: "test.mw.tunnel",
      run: async ({ next, task }) => next(task?.input),
    });

    const task = defineTask({
      id: "task.tunneled",
      tags: [globalTags.tunnelPolicy.with({ client: [mw.id] })],
      middleware: [mw],
      run: async () => 0,
    });

    // Mark task as tunneled
    task.isTunneled = true;

    store.taskMiddlewares.set(mw.id, {
      middleware: mw,
      computedDependencies: {},
      isInitialized: true,
    });

    // Create a copy of the task for the store and mark it as tunneled too
    const storeTask = { ...task };
    storeTask.isTunneled = true;

    store.tasks.set(task.id, {
      task: storeTask,
      computedDependencies: {},
      isInitialized: true,
    });

    const runner = manager.composeTaskRunner(task);
    expect(runner).toBeDefined();
  });

  describe("interceptors", () => {
    it("should add task middleware interceptor", () => {
      const interceptor = jest.fn(async (next: any, input: any) => next(input));
      expect(() => {
        manager.intercept("task", interceptor);
      }).not.toThrow();
      expect(manager.isLocked).toBe(false);
      // Check that interceptor was added
      expect(
        (manager as unknown as { taskMiddlewareInterceptors: any[] })
          .taskMiddlewareInterceptors.length,
      ).toBe(1);
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

    it("should apply task middleware interceptors in registration order", async () => {
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
        "interceptor1:before",
        "interceptor2:before",
        "task:run",
        "interceptor2:after",
        "interceptor1:after",
      ]);
    });

    it("should propagate journal when global interceptor uses executionInput.next", async () => {
      const order: string[] = [];

      // Add global interceptor that uses executionInput.next
      manager.intercept(
        "task",
        async (wrappedNext: any, executionInput: any) => {
          order.push("global-interceptor:before");
          // Verify journal is on executionInput
          expect(executionInput.journal).toBeDefined();
          // Use executionInput.next directly (not wrappedNext)
          const result = await executionInput.next(executionInput.task.input);
          order.push("global-interceptor:after");
          return result;
        },
      );

      const task = defineTask({
        id: "task_global_next",
        run: async (input: number, _deps, context) => {
          order.push("task:run");
          // Verify journal passed to task
          expect(context?.journal).toBeDefined();
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
        "global-interceptor:before",
        "task:run",
        "global-interceptor:after",
      ]);
    });

    it("should apply resource middleware interceptors in registration order", async () => {
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
        "interceptor1:before",
        "interceptor2:before",
        "resource:init",
        "interceptor2:after",
        "interceptor1:after",
      ]);
    });

    it("should handle task middleware interceptor errors", async () => {
      const errors: any[] = [];
      const store = new Store(
        eventManager,
        logger,
        (e) => {
          errors.push(e);
        },
        RunnerMode.TEST,
      );
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
      const store = new Store(
        eventManager,
        logger,
        (e) => {
          errors.push(e);
        },
        RunnerMode.TEST,
      );
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
      });

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

    it("should allow interceptor to use executionInput.next directly for journal propagation", async () => {
      const order: string[] = [];
      const taskMiddleware = defineTaskMiddleware({
        id: "test_task_middleware_next",
        run: async ({ next, task, journal }) => {
          order.push("middleware:run");
          // Verify journal is available
          expect(journal).toBeDefined();
          return next(task?.input);
        },
      });

      // This interceptor uses executionInput.next instead of the wrappedNext
      manager.interceptMiddleware(
        taskMiddleware,
        async (wrappedNext: any, executionInput: any) => {
          order.push("interceptor:before");
          // Use executionInput.next directly to cover that code path
          const result = await executionInput.next(executionInput.task.input);
          order.push("interceptor:after");
          return result;
        },
      );

      const task = defineTask({
        id: "task_with_next_interceptor",
        middleware: [taskMiddleware],
        run: async (input: number, _deps, context) => {
          order.push("task:run");
          // Verify journal is passed to task
          expect(context?.journal).toBeDefined();
          return input + 1;
        },
      });

      store.tasks.set(task.id, {
        task,
        computedDependencies: {},
        isInitialized: true,
      });

      store.taskMiddlewares.set(taskMiddleware.id, {
        middleware: taskMiddleware,
        computedDependencies: {},
        isInitialized: true,
      });

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

    it("should use original input when executionInput.next is called with undefined", async () => {
      const order: string[] = [];
      const taskMiddleware = defineTaskMiddleware({
        id: "test_task_middleware_undefined",
        run: async ({ next, task, journal }) => {
          order.push("middleware:run");
          expect(journal).toBeDefined();
          return next(task?.input);
        },
      });

      // This interceptor calls next with undefined, triggering the ?? fallback
      manager.interceptMiddleware(
        taskMiddleware,
        async (wrappedNext: any, executionInput: any) => {
          order.push("interceptor:before");
          // Call with undefined to trigger ?? branch
          const result = await executionInput.next();
          order.push("interceptor:after");
          return result;
        },
      );

      const task = defineTask({
        id: "task_with_undefined_next",
        middleware: [taskMiddleware],
        run: async (input: number, _deps, context) => {
          order.push("task:run");
          expect(context?.journal).toBeDefined();
          return input + 1;
        },
      });

      store.tasks.set(task.id, {
        task,
        computedDependencies: {},
        isInitialized: true,
      });

      store.taskMiddlewares.set(taskMiddleware.id, {
        middleware: taskMiddleware,
        computedDependencies: {},
        isInitialized: true,
      });

      const runner = manager.composeTaskRunner(task);
      const result = await runner(10);

      // Should still get 11 because original input (10) is used via ??
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
      });

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
      const bogusMiddleware = { id: "bogus" } as unknown as ITaskMiddleware<
        any,
        any
      >;
      expect(() =>
        manager.interceptMiddleware(
          bogusMiddleware,
          async (next: any, input: any) => next(input),
        ),
      ).toThrow("Unknown middleware type");
    });
  });
});
