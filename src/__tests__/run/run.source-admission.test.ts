import {
  defineEvent,
  defineHook,
  defineResource,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { createMessageError } from "../../errors";
import { run } from "../../run";

const SHUTDOWN_REJECTION = /(shutting down|disposed)/i;

function createGate() {
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    wait,
    release: () => release?.(),
  };
}

describe("run source-admission during shutdown drain", () => {
  it("keeps task runs and event emissions open during coolingDown, then locks them when disposing begins", async () => {
    let releaseCooldown: (() => void) | undefined;
    const cooldownGate = new Promise<void>((resolve) => {
      releaseCooldown = resolve;
    });
    let cooldownStarted!: () => void;
    const cooldownReady = new Promise<void>((resolve) => {
      cooldownStarted = resolve;
    });

    const quickTask = defineTask({
      id: "tests-source-coolingdown-quick",
      run: async () => "ok",
    });
    const blocker = createGate();
    const blockerTask = defineTask({
      id: "tests-source-coolingdown-blocker",
      run: async () => {
        await blocker.wait;
      },
    });
    const quickEvent = defineEvent<void>({
      id: "tests-source-coolingdown-event",
    });
    const eventHandler = jest.fn();
    const quickHook = defineHook({
      id: "tests-source-coolingdown-hook",
      on: quickEvent,
      async run() {
        eventHandler();
      },
    });

    const coolingResource = defineResource({
      id: "tests-source-coolingdown-resource",
      register: [quickTask, blockerTask, quickEvent, quickHook],
      async cooldown() {
        cooldownStarted();
        await cooldownGate;
      },
    });

    const app = defineResource({
      id: "tests-source-coolingdown-app",
      register: [coolingResource],
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      dispose: {
        drainingBudgetMs: 200,
        cooldownWindowMs: 20,
      },
    });

    const disposePromise = runtime.dispose();
    await cooldownReady;

    await expect(runtime.runTask(quickTask)).resolves.toBe("ok");
    const inFlightBlocker = runtime.runTask(blockerTask);
    await expect(runtime.emitEvent(quickEvent)).resolves.toBeUndefined();
    expect(eventHandler).toHaveBeenCalledTimes(1);

    if (!releaseCooldown) {
      throw createMessageError("Expected coolingDown gate release handler");
    }
    releaseCooldown();
    await new Promise((r) => setTimeout(r, 5));

    await expect(runtime.runTask(quickTask)).resolves.toBe("ok");
    await expect(runtime.emitEvent(quickEvent)).resolves.toBeUndefined();

    await expect(
      new Promise((resolve) => setTimeout(resolve, 30)).then(() =>
        runtime.runTask(quickTask),
      ),
    ).rejects.toThrow(SHUTDOWN_REJECTION);
    await expect(
      Promise.resolve()
        .then(() => new Promise((resolve) => setTimeout(resolve, 0)))
        .then(() => runtime.emitEvent(quickEvent)),
    ).rejects.toThrow(SHUTDOWN_REJECTION);

    blocker.release();
    await inFlightBlocker;
    await disposePromise;
  });

  it("blocks new runtime calls during disposing", async () => {
    const blocker = createGate();
    const slowTask = defineTask({
      id: "tests-source-runtime-blocker",
      run: async () => {
        await blocker.wait;
      },
    });
    const quickTask = defineTask({
      id: "tests-source-runtime-quick",
      run: async () => "ok",
    });

    const app = defineResource({
      id: "tests-source-runtime-app",
      register: [slowTask, quickTask],
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      dispose: {
        drainingBudgetMs: 200,
      },
    });

    const inFlight = runtime.runTask(slowTask);
    await new Promise((r) => setTimeout(r, 0));

    const disposePromise = runtime.dispose();
    await new Promise((r) => setTimeout(r, 0));

    await expect(
      Promise.resolve().then(() => runtime.runTask(quickTask)),
    ).rejects.toThrow(SHUTDOWN_REJECTION);

    blocker.release();
    await inFlight;
    await disposePromise;
  });

  it("blocks resource-origin calls during disposing", async () => {
    const blocker = createGate();
    const slowTask = defineTask({
      id: "tests-source-resource-blocker",
      run: async () => {
        await blocker.wait;
      },
    });
    const childTask = defineTask({
      id: "tests-source-resource-child",
      run: async () => "ok",
    });

    let resourceCaller: (() => Promise<unknown>) | undefined;
    const callerResource = defineResource({
      id: "tests-source-resource-caller",
      dependencies: {
        runChildTask: childTask,
      },
      init: async (_config, { runChildTask }) => {
        resourceCaller = async () => runChildTask();
        return "ready";
      },
    });

    const app = defineResource({
      id: "tests-source-resource-app",
      register: [slowTask, childTask, callerResource],
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      dispose: {
        drainingBudgetMs: 200,
      },
    });

    const inFlight = runtime.runTask(slowTask);
    await new Promise((r) => setTimeout(r, 0));

    const disposePromise = runtime.dispose();
    await new Promise((r) => setTimeout(r, 0));

    expect(resourceCaller).toBeDefined();
    await expect(resourceCaller!()).rejects.toThrow(SHUTDOWN_REJECTION);

    blocker.release();
    await inFlight;
    await disposePromise;
  });

  it("allows active task continuations during disposing", async () => {
    const blocker = createGate();
    const parentGate = createGate();
    let parentStarted!: () => void;
    const parentReady = new Promise<void>((resolve) => {
      parentStarted = resolve;
    });

    const blockerTask = defineTask({
      id: "tests-source-task-blocker",
      run: async () => {
        await blocker.wait;
      },
    });

    const childTask = defineTask({
      id: "tests-source-task-child",
      run: async () => "child-ok",
    });

    let continuation: (() => Promise<unknown>) | undefined;
    const parentTask = defineTask({
      id: "tests-source-task-parent",
      dependencies: {
        runChildTask: childTask,
      },
      run: async (_input, { runChildTask }) => {
        continuation = async () => runChildTask();
        parentStarted();
        await parentGate.wait;
        return "done";
      },
    });

    const app = defineResource({
      id: "tests-source-task-app",
      register: [blockerTask, childTask, parentTask],
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      dispose: {
        drainingBudgetMs: 200,
      },
    });

    const inFlightParent = runtime.runTask(parentTask);
    const inFlightBlocker = runtime.runTask(blockerTask);
    await parentReady;

    const disposePromise = runtime.dispose();
    await new Promise((r) => setTimeout(r, 0));

    expect(continuation).toBeDefined();
    await expect(continuation!()).resolves.toBe("child-ok");

    parentGate.release();
    blocker.release();
    await inFlightParent;
    await inFlightBlocker;
    await disposePromise;
  });

  it("allows active hook continuations during disposing", async () => {
    const hookGate = createGate();
    let hookStarted!: () => void;
    const hookReady = new Promise<void>((resolve) => {
      hookStarted = resolve;
    });

    const triggerEvent = defineEvent<void>({
      id: "tests-source-hook-event",
    });
    const childTask = defineTask({
      id: "tests-source-hook-child",
      run: async () => "hook-child-ok",
    });

    let continuation: (() => Promise<unknown>) | undefined;
    const hook = defineHook({
      id: "tests-source-hook-listener",
      on: triggerEvent,
      dependencies: {
        runChildTask: childTask,
      },
      run: async (_event, { runChildTask }) => {
        continuation = async () => runChildTask();
        hookStarted();
        await hookGate.wait;
      },
    });

    const app = defineResource({
      id: "tests-source-hook-app",
      register: [triggerEvent, childTask, hook],
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      dispose: {
        drainingBudgetMs: 200,
      },
    });

    const inFlightEvent = runtime.emitEvent(triggerEvent);
    await hookReady;

    const disposePromise = runtime.dispose();
    await new Promise((r) => setTimeout(r, 0));

    expect(continuation).toBeDefined();
    await expect(continuation!()).resolves.toBe("hook-child-ok");

    hookGate.release();
    await inFlightEvent;
    await disposePromise;
  });

  it("allows active middleware continuations during disposing", async () => {
    const middlewareGate = createGate();
    let middlewareStarted!: () => void;
    const middlewareReady = new Promise<void>((resolve) => {
      middlewareStarted = resolve;
    });

    const childTask = defineTask({
      id: "tests-source-middleware-child",
      run: async () => "middleware-child-ok",
    });

    let continuation: (() => Promise<unknown>) | undefined;
    const middleware = defineTaskMiddleware({
      id: "tests-source-middleware-layer",
      dependencies: {
        runChildTask: childTask,
      },
      run: async ({ next, task }, { runChildTask }) => {
        continuation = async () => runChildTask();
        middlewareStarted();
        await middlewareGate.wait;
        return next(task.input);
      },
    });

    const parentTask = defineTask({
      id: "tests-source-middleware-parent",
      middleware: [middleware],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "tests-source-middleware-app",
      register: [childTask, middleware, parentTask],
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      dispose: {
        drainingBudgetMs: 200,
      },
    });

    const inFlightParent = runtime.runTask(parentTask);
    await middlewareReady;

    const disposePromise = runtime.dispose();
    await new Promise((r) => setTimeout(r, 0));

    expect(continuation).toBeDefined();
    await expect(continuation!()).resolves.toBe("middleware-child-ok");

    middlewareGate.release();
    await inFlightParent;
    await disposePromise;
  });

  it("blocks stale task continuation callbacks after source execution completes", async () => {
    const blocker = createGate();
    const blockerTask = defineTask({
      id: "tests-source-stale-blocker",
      run: async () => {
        await blocker.wait;
      },
    });

    const childTask = defineTask({
      id: "tests-source-stale-child",
      run: async () => "child-ok",
    });

    let staleContinuation: (() => Promise<unknown>) | undefined;
    const parentTask = defineTask({
      id: "tests-source-stale-parent",
      dependencies: {
        runChildTask: childTask,
      },
      run: async (_input, { runChildTask }) => {
        staleContinuation = async () => runChildTask();
        return "parent-done";
      },
    });

    const app = defineResource({
      id: "tests-source-stale-app",
      register: [blockerTask, childTask, parentTask],
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      dispose: {
        drainingBudgetMs: 200,
      },
    });

    await expect(runtime.runTask(parentTask)).resolves.toBe("parent-done");
    const inFlightBlocker = runtime.runTask(blockerTask);
    await new Promise((r) => setTimeout(r, 0));

    const disposePromise = runtime.dispose();
    await new Promise((r) => setTimeout(r, 0));

    expect(staleContinuation).toBeDefined();
    await expect(staleContinuation!()).rejects.toThrow(SHUTDOWN_REJECTION);

    blocker.release();
    await inFlightBlocker;
    await disposePromise;
  });
});
