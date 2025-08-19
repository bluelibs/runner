import { MiddlewareManager } from "../../models/MiddlewareManager";
import { Store } from "../../models/Store";
import { EventManager } from "../../models/EventManager";
import { Logger } from "../../models/Logger";
import { defineTask, defineResource } from "../../define";
import { middleware, OnUnhandledError } from "../../index";
import { globalEvents } from "../../globals/globalEvents";

describe("MiddlewareManager", () => {
  let store: Store;
  let eventManager: EventManager;
  let logger: Logger;
  let manager: MiddlewareManager;
  let onUnhandledError: OnUnhandledError;
  beforeEach(() => {
    eventManager = new EventManager();
    logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    onUnhandledError = jest.fn();
    store = new Store(eventManager, logger, onUnhandledError);
    manager = new MiddlewareManager(store, eventManager, logger);
  });

  it("composes task runner with interceptors inside middleware and preserves order", async () => {
    const order: string[] = [];

    const m1 = middleware.task({
      id: "m1",
      run: async ({ next, task }) => {
        order.push("m1:before");
        const result = await next(task?.input);
        order.push("m1:after");
        return result;
      },
    });

    const m2 = middleware.task({
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
    } as any);
    store.taskMiddlewares.set(m2.id, {
      middleware: m2,
      computedDependencies: {},
    } as any);

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
    // Event-specific listeners should be called
    eventManager.addListener(globalEvents.middlewareTriggered, async () => {
      calls.push("triggered");
    });
    eventManager.addListener(globalEvents.middlewareCompleted, async () => {
      calls.push("completed");
    });

    const mLocal = middleware.task({
      id: "shared",
      run: async ({ next, task }) => {
        const res = await next(task?.input);
        return (res as number) + 3;
      },
    });
    const mOther = middleware.task({
      id: "other",
      run: async ({ next, task }) => {
        const res = await next(task?.input);
        return (res as number) * 2;
      },
    });
    const mGlobalSameId = middleware.task({
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
    const triggeredCount = calls.filter((c) => c === "triggered").length;
    const completedCount = calls.filter((c) => c === "completed").length;
    const globalCalls = calls.filter((c) => c === "globalListener").length;
    expect(triggeredCount).toBe(2);
    expect(completedCount).toBe(2);
    expect(globalCalls).toBe(0);

    spy.mockRestore();
  });

  it("routes errors from failing middleware and still emits completed with error", async () => {
    const errors: any[] = [];
    const store = new Store(eventManager, logger, (e) => {
      errors.push(e);
    });
    const manager = new MiddlewareManager(store, eventManager, logger);

    const calls: Array<{ kind: string; error?: any }> = [];
    eventManager.addListener(globalEvents.middlewareCompleted, async (e) => {
      calls.push({ kind: (e.data as any).kind, error: (e.data as any).error });
    });

    const failing = middleware.task({
      id: "failing",
      run: async () => {
        throw new Error("boom");
      },
    });
    const task = defineTask({
      id: "t3",
      middleware: [failing],
      run: async () => 1,
    });
    store.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: true,
    });
    store.taskMiddlewares.set(failing.id, {
      middleware: failing,
      computedDependencies: {},
    } as any);

    const runner = manager.composeTaskRunner(task);
    await expect(runner(undefined as any)).rejects.toThrow("boom");

    expect(errors.length).toBe(1);
    expect(errors[0].kind).toBe("middleware");
    expect(errors[0].source).toBe("failing");

    // completed emitted with error
    expect(calls.length).toBe(1);
    expect(calls[0].kind).toBe("task");
    expect(calls[0].error).toBeInstanceOf(Error);
  });

  it("wraps resource init with middleware and returns modified result", async () => {
    const m = middleware.resource({
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
    const mw = middleware
      .task({
        id: "mw",
        dependencies: { t: task },
        run: async ({ next, task }) => next(task?.input),
      })
      .everywhere(true);
    // register via public API to ensure types are respected
    store.storeGenericItem(mw);
    const res = manager.getEverywhereMiddlewareForTasks(task);
    expect(res).toHaveLength(0);
  });

  it("getEverywhereMiddlewareForResources excludes middleware that depends on the resource", () => {
    const resource = defineResource({ id: "res.dep" });
    const mw2 = middleware
      .resource({
        id: "mw2",
        dependencies: { r: resource },
        run: async ({ next, resource }) => next(resource?.config),
      })
      .everywhere(true);
    store.storeGenericItem(mw2);
    const res = manager.getEverywhereMiddlewareForResources(resource);
    expect(res).toHaveLength(0);
  });
});
