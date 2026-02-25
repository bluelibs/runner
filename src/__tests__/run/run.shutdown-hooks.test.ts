import {
  defineEvent,
  defineHook,
  defineResource,
  defineTask,
} from "../../define";
import { globalEvents } from "../../globals/globalEvents";
import { run } from "../../run";
import { createMessageError } from "../../errors";
import { getPlatform } from "../../platform";

describe("run.ts shutdown hooks & error boundary", () => {
  const capturedExitCalls: number[] = [];
  let exitSpy: jest.SpyInstance<void, [number]> | undefined;

  beforeEach(() => {
    capturedExitCalls.length = 0;
    exitSpy?.mockRestore();
    exitSpy = jest.spyOn(getPlatform(), "exit").mockImplementation((code) => {
      capturedExitCalls.push(code);
    });
  });

  afterAll(() => {
    exitSpy?.mockRestore();
    exitSpy = undefined;
  });

  it("installs process safety nets and calls onUnhandledError for uncaughtException", async () => {
    const app = defineResource({
      id: "tests.app.safety",
      async init() {
        return "ok" as const;
      },
    });

    const onUnhandledError = jest.fn();
    const { dispose } = await run(app, {
      errorBoundary: true,
      shutdownHooks: false,
      onUnhandledError: async ({ error, kind, source }) => {
        onUnhandledError(error, kind, source);
      },
    });

    // Emit uncaughtException without killing the process by catching internally
    process.emit("uncaughtException", new Error("boom-uncaught"));

    // Give event loop a tick
    await new Promise((r) => setTimeout(r, 0));

    expect(onUnhandledError).toHaveBeenCalled();
    const err = onUnhandledError.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);

    await dispose();
  });

  it("calls onUnhandledError on unhandledRejection", async () => {
    const app = defineResource({
      id: "tests.app.unhandledRejection",
      async init() {
        return "ok" as const;
      },
    });

    const onUnhandledError = jest.fn();
    const { dispose } = await run(app, {
      errorBoundary: true,
      shutdownHooks: false,
      onUnhandledError: async ({ error, kind, source }) =>
        onUnhandledError(error, kind, source),
    });

    process.emit(
      "unhandledRejection",
      new Error("boom-unhandled"),
      Promise.resolve(),
    );

    await new Promise((r) => setTimeout(r, 0));

    expect(onUnhandledError).toHaveBeenCalled();
    const err = onUnhandledError.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);

    await dispose();
  });

  it("calls dispose() on SIGTERM and exits gracefully", async () => {
    expect.assertions(2);
    const disposed: string[] = [];
    const app = defineResource({
      id: "tests.app.shutdown",
      async init() {
        return "ok" as const;
      },
      async dispose(value) {
        disposed.push(String(value));
      },
    });

    const runtime = await run(app, {
      errorBoundary: false,
      shutdownHooks: true,
    });
    const { value } = runtime;

    process.emit("SIGTERM");

    await new Promise((r) => setTimeout(r, 0));

    expect(disposed).toContain(String(value));
    expect(capturedExitCalls[0]).toBe(0);
    await runtime.dispose();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("cancels bootstrap and disposes initialized resources when SIGTERM arrives mid-startup", async () => {
    expect.assertions(3);

    const disposed: string[] = [];
    let releaseChildInit: (() => void) | undefined;
    const childInitGate = new Promise<void>((resolve) => {
      releaseChildInit = resolve;
    });

    const slowChild = defineResource({
      id: "tests.app.shutdown.bootstrap.child",
      async init() {
        await childInitGate;
        return "child";
      },
      async dispose(value) {
        disposed.push(String(value));
      },
    });

    const app = defineResource({
      id: "tests.app.shutdown.bootstrap",
      register: [slowChild],
      async init() {
        return "root";
      },
    });

    const runtimePromise = run(app, {
      errorBoundary: false,
      shutdownHooks: true,
      disposeDrainBudgetMs: 50,
    });

    await new Promise((r) => setTimeout(r, 0));
    process.emit("SIGTERM");
    await new Promise((r) => setTimeout(r, 0));

    if (!releaseChildInit) {
      throw createMessageError(
        "Expected child resource initialization to start",
      );
    }
    releaseChildInit();

    await expect(runtimePromise).rejects.toThrow(
      /shutdown requested during bootstrap/,
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(disposed).toContain("child");
    expect(capturedExitCalls[0]).toBe(0);
  });

  it("disposes runtime when SIGTERM arrives late in bootstrap after cancellation checkpoints", async () => {
    expect.assertions(2);

    let disposed = false;
    const emitShutdownOnInit = defineHook({
      id: "tests.app.shutdown.bootstrap.late-signal.hook",
      on: globalEvents.ready,
      async run() {
        process.emit("SIGTERM");
      },
    });

    const app = defineResource({
      id: "tests.app.shutdown.bootstrap.late-signal",
      register: [emitShutdownOnInit],
      async init() {
        return "ok";
      },
      async dispose() {
        disposed = true;
      },
    });

    const runtime = await run(app, {
      errorBoundary: false,
      shutdownHooks: true,
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(disposed).toBe(true);
    expect(capturedExitCalls[0]).toBe(0);
    await runtime.dispose();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("exits with code 1 when shutdown disposers fail", async () => {
    expect.assertions(2);
    const app = defineResource({
      id: "tests.app.shutdown.fail",
      async init() {
        return "ok" as const;
      },
      async dispose() {
        throw createMessageError("dispose failed");
      },
    });

    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const runtime = await run(app, {
        errorBoundary: false,
        shutdownHooks: true,
      });

      process.emit("SIGTERM");
      await new Promise((r) => setTimeout(r, 0));

      expect(capturedExitCalls[0]).toBe(1);
      expect(consoleSpy).toHaveBeenCalled();
      await runtime.dispose();
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("enters shutdown lockdown, blocks new work, and waits for in-flight work before teardown", async () => {
    let releaseTask: (() => void) | undefined;
    const taskGate = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });

    let releaseEvent: (() => void) | undefined;
    const eventGate = new Promise<void>((resolve) => {
      releaseEvent = resolve;
    });

    const slowTask = defineTask({
      id: "tests.app.shutdown.lockdown.task",
      async run() {
        await taskGate;
        return "done";
      },
    });

    const slowEvent = defineEvent({
      id: "tests.app.shutdown.lockdown.event",
    });

    const slowHook = defineHook({
      id: "tests.app.shutdown.lockdown.hook",
      on: slowEvent,
      async run() {
        await eventGate;
      },
    });

    let disposed = false;
    const app = defineResource({
      id: "tests.app.shutdown.lockdown",
      register: [slowTask, slowEvent, slowHook],
      async init() {
        return "ok" as const;
      },
      async dispose() {
        disposed = true;
      },
    });

    const runtime = await run(app, {
      errorBoundary: false,
      shutdownHooks: true,
      disposeDrainBudgetMs: 150,
    });

    const inFlightTask = runtime.runTask(slowTask);
    const inFlightEvent = runtime.emitEvent(slowEvent, undefined);

    await new Promise((r) => setTimeout(r, 0));
    process.emit("SIGTERM");
    await new Promise((r) => setTimeout(r, 0));

    await expect(
      Promise.resolve().then(() => runtime.runTask(slowTask)),
    ).rejects.toThrow(/(shutting down|disposed)/i);
    await expect(
      Promise.resolve().then(() => runtime.emitEvent(slowEvent)),
    ).rejects.toThrow(/(shutting down|disposed)/i);

    if (!releaseTask || !releaseEvent) {
      throw createMessageError("Expected shutdown gates to be initialized");
    }

    expect(disposed).toBe(false);

    releaseTask();
    releaseEvent();

    await inFlightTask;
    await inFlightEvent;
    await new Promise((r) => setTimeout(r, 0));

    expect(disposed).toBe(true);
    expect(capturedExitCalls[0]).toBe(0);

    await runtime.dispose();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("continues shutdown without waiting for drain budget", async () => {
    const neverTask = defineTask({
      id: "tests.app.shutdown.timeout.task",
      async run() {
        return new Promise<never>(() => undefined);
      },
    });

    let disposed = false;
    const app = defineResource({
      id: "tests.app.shutdown.timeout",
      register: [neverTask],
      async init() {
        return "ok" as const;
      },
      async dispose() {
        disposed = true;
      },
    });

    const runtime = await run(app, {
      errorBoundary: false,
      shutdownHooks: true,
      disposeDrainBudgetMs: 20,
    });

    void runtime.runTask(neverTask);
    await new Promise((r) => setTimeout(r, 0));
    process.emit("SIGTERM");

    await new Promise((r) => setTimeout(r, 10));
    expect(disposed).toBe(false);

    await new Promise((r) => setTimeout(r, 20));

    expect(disposed).toBe(true);
    expect(capturedExitCalls[0]).toBe(0);
    await expect(
      Promise.resolve().then(() => runtime.runTask(neverTask)),
    ).rejects.toThrow(/(disposed|shutting down)/i);
    await runtime.dispose();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("manual dispose enters lockdown and waits for in-flight work before teardown", async () => {
    let releaseTask: (() => void) | undefined;
    const taskGate = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });

    let releaseEvent: (() => void) | undefined;
    const eventGate = new Promise<void>((resolve) => {
      releaseEvent = resolve;
    });

    const slowTask = defineTask({
      id: "tests.app.manual-dispose.lockdown.task",
      async run() {
        await taskGate;
        return "done";
      },
    });

    const slowEvent = defineEvent({
      id: "tests.app.manual-dispose.lockdown.event",
    });

    const slowHook = defineHook({
      id: "tests.app.manual-dispose.lockdown.hook",
      on: slowEvent,
      async run() {
        await eventGate;
      },
    });

    let disposed = false;
    const app = defineResource({
      id: "tests.app.manual-dispose.lockdown",
      register: [slowTask, slowEvent, slowHook],
      async init() {
        return "ok" as const;
      },
      async dispose() {
        disposed = true;
      },
    });

    const runtime = await run(app, {
      errorBoundary: false,
      shutdownHooks: false,
      disposeDrainBudgetMs: 150,
    });

    const inFlightTask = runtime.runTask(slowTask);
    const inFlightEvent = runtime.emitEvent(slowEvent, undefined);

    const disposePromise = runtime.dispose();
    let disposeResolved = false;
    void disposePromise.then(() => {
      disposeResolved = true;
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(disposed).toBe(false);
    expect(disposeResolved).toBe(false);
    await expect(
      Promise.resolve().then(() => runtime.runTask(slowTask)),
    ).rejects.toThrow(/(disposed|shutting down)/i);
    await expect(
      Promise.resolve().then(() => runtime.emitEvent(slowEvent)),
    ).rejects.toThrow(/(disposed|shutting down)/i);

    if (!releaseTask || !releaseEvent) {
      throw createMessageError(
        "Expected manual dispose gates to be initialized",
      );
    }

    releaseTask();
    releaseEvent();

    await inFlightTask;
    await inFlightEvent;
    await disposePromise;

    expect(disposed).toBe(true);
  });

  it("manual dispose proceeds without waiting for drain budget", async () => {
    const neverTask = defineTask({
      id: "tests.app.manual-dispose.timeout.task",
      async run() {
        return new Promise<never>(() => undefined);
      },
    });

    let disposed = false;
    const app = defineResource({
      id: "tests.app.manual-dispose.timeout",
      register: [neverTask],
      async init() {
        return "ok" as const;
      },
      async dispose() {
        disposed = true;
      },
    });

    const runtime = await run(app, {
      errorBoundary: false,
      shutdownHooks: false,
      disposeDrainBudgetMs: 20,
    });

    void runtime.runTask(neverTask);
    const disposePromise = runtime.dispose();
    await new Promise((r) => setTimeout(r, 10));
    expect(disposed).toBe(false);

    await new Promise((r) => setTimeout(r, 20));

    expect(disposed).toBe(true);
    await expect(disposePromise).resolves.toBeUndefined();
    expect(() => runtime.runTask(neverTask)).toThrow(/disposed/i);
  });

  it("caps drain wait by remaining dispose budget", async () => {
    jest.useFakeTimers();

    try {
      const neverTask = defineTask({
        id: "tests.app.shutdown.dispose-budget-cap.task",
        async run() {
          return new Promise<never>(() => undefined);
        },
      });

      let disposed = false;
      const app = defineResource({
        id: "tests.app.shutdown.dispose-budget-cap",
        register: [neverTask],
        async init() {
          return "ok" as const;
        },
        async dispose() {
          disposed = true;
        },
      });

      const runtime = await run(app, {
        errorBoundary: false,
        shutdownHooks: false,
        disposeBudgetMs: 30,
        disposeDrainBudgetMs: 1_000,
      });

      void runtime.runTask(neverTask);
      const disposePromise = runtime.dispose();
      await Promise.resolve();

      jest.advanceTimersByTime(29);
      await Promise.resolve();
      expect(disposed).toBe(false);

      jest.advanceTimersByTime(2);
      await Promise.resolve();
      await expect(disposePromise).resolves.toBeUndefined();
      expect(disposed).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not wait for resource disposal when dispose budget is zero", async () => {
    let disposeCalls = 0;
    const app = defineResource({
      id: "tests.app.shutdown.dispose-budget.zero",
      async init() {
        return "ok" as const;
      },
      async dispose() {
        disposeCalls += 1;
        throw createMessageError("detached dispose failure");
      },
    });

    const runtime = await run(app, {
      errorBoundary: false,
      shutdownHooks: false,
      disposeBudgetMs: 0,
      disposeDrainBudgetMs: 0,
    });

    await expect(runtime.dispose()).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(disposeCalls).toBe(1);
  });

  it("stops waiting for resource disposal when dispose budget expires", async () => {
    jest.useFakeTimers();

    try {
      let releaseResourceDispose: (() => void) | undefined;
      let disposeStarted = false;
      let disposeCompleted = false;

      const app = defineResource({
        id: "tests.app.shutdown.dispose-budget.resource-timeout",
        async init() {
          return "ok" as const;
        },
        async dispose() {
          disposeStarted = true;
          await new Promise<void>((resolve) => {
            releaseResourceDispose = resolve;
          });
          disposeCompleted = true;
        },
      });

      const runtime = await run(app, {
        errorBoundary: false,
        shutdownHooks: false,
        disposeBudgetMs: 20,
        disposeDrainBudgetMs: 0,
      });

      const disposePromise = runtime.dispose();
      jest.advanceTimersByTime(1);
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
      }

      expect(disposeCompleted).toBe(false);

      jest.advanceTimersByTime(20);
      await Promise.resolve();
      await expect(disposePromise).resolves.toBeUndefined();
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
      }
      expect(disposeStarted).toBe(true);
      expect(disposeCompleted).toBe(false);

      if (!releaseResourceDispose) {
        throw createMessageError("Expected resource dispose to begin");
      }

      releaseResourceDispose();
      await Promise.resolve();
      expect(disposeCompleted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("process signal emits disposing and allows its in-flight continuations before drain", async () => {
    const postDisposingEvent = defineEvent({
      id: "tests.app.shutdown.signal-disposing.event",
    });

    const postDisposingHandler = jest.fn();
    const postDisposingHook = defineHook({
      id: "tests.app.shutdown.signal-disposing.handler",
      on: postDisposingEvent,
      async run() {
        postDisposingHandler();
      },
    });

    const disposingHook = defineHook({
      id: "tests.app.shutdown.signal-disposing.lifecycle-hook",
      on: globalEvents.disposing,
      dependencies: {
        emitPostDisposingEvent: postDisposingEvent,
      },
      async run(_event, { emitPostDisposingEvent }) {
        await emitPostDisposingEvent(undefined);
      },
    });

    const app = defineResource({
      id: "tests.app.shutdown.signal-disposing",
      register: [postDisposingEvent, postDisposingHook, disposingHook],
      async init() {
        return "ok";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: true,
      errorBoundary: false,
    });

    process.emit("SIGTERM");
    await new Promise((r) => setTimeout(r, 0));

    expect(postDisposingHandler).toHaveBeenCalledTimes(1);
    await runtime.dispose();
  });

  it("manual dispose emits disposing then drained then resource dispose", async () => {
    const lifecycleOrder: string[] = [];
    const postDisposingEvent = defineEvent({
      id: "tests.app.dispose.lifecycle.post-disposing.event",
    });

    const postDisposingHandler = defineHook({
      id: "tests.app.dispose.lifecycle.post-disposing.handler",
      on: postDisposingEvent,
      async run() {
        lifecycleOrder.push("post-disposing-event");
      },
    });

    const disposingHook = defineHook({
      id: "tests.app.dispose.lifecycle.disposing-hook",
      on: globalEvents.disposing,
      dependencies: {
        emitPostDisposingEvent: postDisposingEvent,
      },
      async run(_event, { emitPostDisposingEvent }) {
        lifecycleOrder.push("disposing");
        await emitPostDisposingEvent(undefined);
      },
    });

    const drainedHook = defineHook({
      id: "tests.app.dispose.lifecycle.drained-hook",
      on: globalEvents.drained,
      async run() {
        lifecycleOrder.push("drained");
      },
    });

    const app = defineResource({
      id: "tests.app.dispose.lifecycle",
      register: [
        postDisposingEvent,
        postDisposingHandler,
        disposingHook,
        drainedHook,
      ],
      async init() {
        return "ok";
      },
      async dispose() {
        lifecycleOrder.push("resource-dispose");
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
    });

    await runtime.dispose();

    expect(lifecycleOrder).toEqual([
      "disposing",
      "post-disposing-event",
      "drained",
      "resource-dispose",
    ]);
  });
});
