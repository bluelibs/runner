import { defineHook, defineResource, defineTask } from "../../define";
import { globalEvents } from "../../globals/globalEvents";
import { run } from "../../run";

describe("runtime forced disposal", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("skips cooldown lifecycle events and drain wait when force disposal starts immediately", async () => {
    const lifecycleCalls: string[] = [];
    let releaseTask!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });

    const slowTask = defineTask({
      id: "runtime-force-dispose-slow-task",
      run: async () => {
        await blocker;
        return "done";
      },
    });

    const parent = defineResource({
      id: "runtime-force-dispose-parent",
      async init() {
        return "parent";
      },
      async cooldown() {
        lifecycleCalls.push("parent:cooldown");
      },
      async dispose() {
        lifecycleCalls.push("parent:dispose");
      },
    });

    const child = defineResource({
      id: "runtime-force-dispose-child",
      dependencies: { parent },
      async init() {
        return "child";
      },
      async cooldown() {
        lifecycleCalls.push("child:cooldown");
      },
      async dispose() {
        lifecycleCalls.push("child:dispose");
      },
    });

    const onDisposing = defineHook({
      id: "runtime-force-dispose-on-disposing",
      on: globalEvents.disposing,
      run: async () => {
        lifecycleCalls.push("event:disposing");
      },
    });

    const onDrained = defineHook({
      id: "runtime-force-dispose-on-drained",
      on: globalEvents.drained,
      run: async () => {
        lifecycleCalls.push("event:drained");
      },
    });

    const app = defineResource({
      id: "runtime-force-dispose-app",
      register: [slowTask, parent, child, onDisposing, onDrained],
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      dispose: {
        totalBudgetMs: 30_000,
        drainingBudgetMs: 30_000,
        cooldownWindowMs: 0,
      },
    });

    const inFlightTask = runtime.runTask(slowTask);
    const disposePromise = runtime.dispose({ force: true });

    expect(() => runtime.runTask(slowTask)).toThrow(/shutdown|disposed/i);

    releaseTask();
    await expect(inFlightTask).resolves.toBe("done");
    await expect(disposePromise).resolves.toBeUndefined();
    expect(lifecycleCalls).toEqual(["child:dispose", "parent:dispose"]);
  });

  it("escalates a graceful shutdown into forced disposal after cooldown has started", async () => {
    const lifecycleCalls: string[] = [];
    let markCooldownStarted!: () => void;
    const cooldownStarted = new Promise<void>((resolve) => {
      markCooldownStarted = resolve;
    });
    let releaseCooldown!: () => void;
    const cooldownBlocker = new Promise<void>((resolve) => {
      releaseCooldown = resolve;
    });

    const resource = defineResource({
      id: "runtime-force-escalation-resource",
      async init() {
        return "ready";
      },
      async cooldown() {
        lifecycleCalls.push("resource:cooldown");
        markCooldownStarted();
        await cooldownBlocker;
      },
      async dispose() {
        lifecycleCalls.push("resource:dispose");
      },
    });

    const onDisposing = defineHook({
      id: "runtime-force-escalation-on-disposing",
      on: globalEvents.disposing,
      run: async () => {
        lifecycleCalls.push("event:disposing");
      },
    });

    const onDrained = defineHook({
      id: "runtime-force-escalation-on-drained",
      on: globalEvents.drained,
      run: async () => {
        lifecycleCalls.push("event:drained");
      },
    });

    const app = defineResource({
      id: "runtime-force-escalation-app",
      register: [resource, onDisposing, onDrained],
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      dispose: {
        totalBudgetMs: 30_000,
        drainingBudgetMs: 20_000,
        cooldownWindowMs: 1_000,
      },
    });

    const gracefulDisposePromise = runtime.dispose();
    await cooldownStarted;

    const forcedDisposePromise = runtime.dispose({ force: true });

    expect(forcedDisposePromise).toBe(gracefulDisposePromise);

    releaseCooldown();
    await expect(forcedDisposePromise).resolves.toBeUndefined();
    expect(lifecycleCalls).toEqual(["resource:cooldown", "resource:dispose"]);
  });

  it("blocks lazy wakeup immediately during forced disposal", async () => {
    const lazyInit = jest.fn(async () => "lazy");

    const lazyResource = defineResource({
      id: "runtime-force-lazy-resource",
      init: lazyInit,
    });

    const app = defineResource({
      id: "runtime-force-lazy-app",
      register: [lazyResource],
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, {
      lazy: true,
      shutdownHooks: false,
    });

    const disposePromise = runtime.dispose({ force: true });

    await expect(runtime.getLazyResourceValue(lazyResource)).rejects.toThrow(
      /shutdown|disposed/i,
    );
    await expect(disposePromise).resolves.toBeUndefined();
    expect(lazyInit).not.toHaveBeenCalled();
  });

  it("cancels drain waiting when force arrives after graceful shutdown reached drain", async () => {
    let releaseTask!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });
    const lifecycleCalls: string[] = [];

    const slowTask = defineTask({
      id: "runtime-force-dispose-drain-task",
      run: async () => {
        await blocker;
        return "done";
      },
    });

    const app = defineResource({
      id: "runtime-force-dispose-drain-app",
      register: [slowTask],
      async init() {
        return "ready";
      },
      async cooldown() {
        lifecycleCalls.push("cooldown");
      },
      async dispose() {
        lifecycleCalls.push("dispose");
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      dispose: {
        totalBudgetMs: 30_000,
        drainingBudgetMs: 30_000,
        cooldownWindowMs: 0,
      },
    });

    const inFlightTask = runtime.runTask(slowTask);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const gracefulDisposePromise = runtime.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const forcedDisposePromise = runtime.dispose({ force: true });

    expect(forcedDisposePromise).toBe(gracefulDisposePromise);
    await expect(forcedDisposePromise).resolves.toBeUndefined();
    expect(lifecycleCalls).toEqual(["cooldown", "dispose"]);

    releaseTask();
    await expect(inFlightTask).resolves.toBe("done");
  });
});
