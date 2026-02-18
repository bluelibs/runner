import {
  defineEvent,
  defineHook,
  defineResource,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { run } from "../../run";
import { ResourceInitMode } from "../../types/runner";

describe("run lazy init mode behavior", () => {
  const waitFor = async (
    condition: () => boolean,
    timeoutMs = 120,
    intervalMs = 5,
  ) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (condition()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return condition();
  };

  it("initializes startup-required resources in parallel and keeps startup-unused resources lazy", async () => {
    let releaseParallelInits!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseParallelInits = resolve;
    });
    let firstStarted = false;
    let secondStarted = false;
    const unusedInit = jest.fn(async () => "unused");

    const first = defineResource({
      id: "init.mode.lazy.parallel.first",
      async init() {
        firstStarted = true;
        await gate;
        return "first";
      },
    });

    const second = defineResource({
      id: "init.mode.lazy.parallel.second",
      async init() {
        secondStarted = true;
        await gate;
        return "second";
      },
    });

    const unused = defineResource({
      id: "init.mode.lazy.parallel.unused",
      init: unusedInit,
    });

    const app = defineResource({
      id: "init.mode.lazy.parallel.app",
      register: [first, second, unused],
      dependencies: { first, second },
      async init() {
        return "ok";
      },
    });

    const runtimePromise = run(app, {
      lazy: true,
      initMode: ResourceInitMode.Parallel,
      shutdownHooks: false,
    });

    const bothStarted = await waitFor(() => firstStarted && secondStarted, 120);
    expect(bothStarted).toBe(true);
    expect(unusedInit).toHaveBeenCalledTimes(0);

    releaseParallelInits();
    const runtime = await runtimePromise;

    expect(() => runtime.getResourceValue(unused)).toThrow(
      /getLazyResourceValue/,
    );

    await expect(runtime.getLazyResourceValue(unused)).resolves.toBe("unused");
    expect(unusedInit).toHaveBeenCalledTimes(1);

    await runtime.dispose();
  });

  it("keeps startup initialization sequential in lazy mode when initMode is sequential", async () => {
    let releaseFirstInit!: () => void;
    const firstInitGate = new Promise<void>((resolve) => {
      releaseFirstInit = resolve;
    });
    let firstStarted = false;
    let secondStarted = false;

    const first = defineResource({
      id: "init.mode.lazy.sequential.first",
      async init() {
        firstStarted = true;
        await firstInitGate;
        return "first";
      },
    });

    const second = defineResource({
      id: "init.mode.lazy.sequential.second",
      async init() {
        secondStarted = true;
        return "second";
      },
    });

    const app = defineResource({
      id: "init.mode.lazy.sequential.app",
      register: [first, second],
      dependencies: { first, second },
      async init() {
        return "ok";
      },
    });

    const runtimePromise = run(app, { lazy: true, shutdownHooks: false });
    const firstHasStarted = await waitFor(() => firstStarted, 120);

    expect(firstHasStarted).toBe(true);
    expect(secondStarted).toBe(false);

    releaseFirstInit();
    const runtime = await runtimePromise;
    await runtime.dispose();
  });

  it("lazy-loading a resource initializes its lazy resource dependencies first", async () => {
    const initOrder: string[] = [];

    const lazyResourceB = defineResource({
      id: "init.mode.lazy.chain.b",
      async init() {
        initOrder.push("b");
        return { id: "b" };
      },
    });

    const lazyResourceA = defineResource({
      id: "init.mode.lazy.chain.a",
      dependencies: { lazyResourceB },
      async init(_, { lazyResourceB }) {
        initOrder.push("a");
        return { from: lazyResourceB.id };
      },
    });

    const app = defineResource({
      id: "init.mode.lazy.chain.app",
      register: [lazyResourceA, lazyResourceB],
      async init() {
        return "ok";
      },
    });

    const runtime = await run(app, { lazy: true, shutdownHooks: false });

    expect(initOrder).toEqual([]);

    await expect(runtime.getLazyResourceValue(lazyResourceA)).resolves.toEqual({
      from: "b",
    });
    expect(initOrder).toEqual(["b", "a"]);

    await expect(runtime.getLazyResourceValue(lazyResourceB)).resolves.toEqual({
      id: "b",
    });
    expect(initOrder).toEqual(["b", "a"]);

    await runtime.dispose();
  });

  it("initializes task middleware resource dependencies during startup in lazy+parallel mode", async () => {
    const warmupInit = jest.fn(async () => ({ warmed: true }));
    const cacheWarmup = defineResource({
      id: "init.mode.lazy.middleware.cacheWarmup",
      init: warmupInit,
    });

    const auditMiddleware = defineTaskMiddleware({
      id: "init.mode.lazy.middleware.audit",
      dependencies: { cacheWarmup },
      run: async ({ next }, { cacheWarmup }) => {
        expect(cacheWarmup.warmed).toBe(true);
        return next();
      },
    });

    const work = defineTask({
      id: "init.mode.lazy.middleware.work",
      middleware: [auditMiddleware],
      run: async () => "done",
    });

    const app = defineResource({
      id: "init.mode.lazy.middleware.app",
      register: [cacheWarmup, auditMiddleware, work],
      dependencies: { work },
      init: async (_, { work }) => {
        const out = await work();
        expect(out).toBe("done");
        return "ok";
      },
    });

    const runtime = await run(app, {
      lazy: true,
      initMode: ResourceInitMode.Parallel,
      shutdownHooks: false,
    });

    expect(warmupInit).toHaveBeenCalledTimes(1);
    expect(runtime.getResourceValue(cacheWarmup)).toEqual({ warmed: true });

    await runtime.dispose();
  });

  it("initializes hook resource dependencies during startup in lazy+parallel mode", async () => {
    const hookResourceInit = jest.fn(async () => ({ ready: "hook-dep" }));
    const hookDep = defineResource({
      id: "init.mode.lazy.hook.dependency",
      init: hookResourceInit,
    });

    const appEvent = defineEvent<{ ok: true }>({
      id: "init.mode.lazy.hook.event",
    });

    const seen: string[] = [];
    const hook = defineHook({
      id: "init.mode.lazy.hook.listener",
      on: appEvent,
      dependencies: { hookDep },
      run: async (_event, { hookDep }) => {
        seen.push(hookDep.ready);
      },
    });

    const app = defineResource({
      id: "init.mode.lazy.hook.app",
      register: [hookDep, appEvent, hook],
      dependencies: { appEvent },
      init: async (_, { appEvent }) => {
        await appEvent({ ok: true });
        return "ok";
      },
    });

    const runtime = await run(app, {
      lazy: true,
      initMode: ResourceInitMode.Parallel,
      shutdownHooks: false,
    });

    expect(hookResourceInit).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["hook-dep"]);
    expect(runtime.getResourceValue(hookDep)).toEqual({ ready: "hook-dep" });

    await runtime.dispose();
  });
});
