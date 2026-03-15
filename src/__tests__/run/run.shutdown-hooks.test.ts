import {
  defineEvent,
  defineHook,
  defineResource,
  defineTask,
} from "../../define";
import { globalResources } from "../../globals/globalResources";
import { globalEvents } from "../../globals/globalEvents";
import { run } from "../../run";
import { createMessageError } from "../../errors";
import { getPlatform } from "../../platform";
import { runtimeSource } from "../../types/runtimeSource";

async function flushMicrotasks(iterations: number = 12): Promise<void> {
  for (let i = 0; i < iterations; i += 1) {
    await Promise.resolve();
  }
}

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
      id: "tests-app-safety",
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
      id: "tests-app-unhandledRejection",
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
      id: "tests-app-shutdown",
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
      id: "tests-app-shutdown-bootstrap-child",
      async init() {
        await childInitGate;
        return "child";
      },
      async dispose(value) {
        disposed.push(String(value));
      },
    });

    const app = defineResource({
      id: "tests-app-shutdown-bootstrap",
      register: [slowChild],
      async init() {
        return "root";
      },
    });

    const runtimePromise = run(app, {
      errorBoundary: false,
      shutdownHooks: true,
      dispose: {
        drainingBudgetMs: 50,
      },
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
      id: "tests-app-shutdown-bootstrap-late-signal-hook",
      on: globalEvents.ready,
      async run() {
        process.emit("SIGTERM");
      },
    });

    const app = defineResource({
      id: "tests-app-shutdown-bootstrap-late-signal",
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
      id: "tests-app-shutdown-fail",
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
      id: "tests-app-shutdown-lockdown-task",
      async run() {
        await taskGate;
        return "done";
      },
    });

    const slowEvent = defineEvent({
      id: "tests-app-shutdown-lockdown-event",
    });

    const slowHook = defineHook({
      id: "tests-app-shutdown-lockdown-hook",
      on: slowEvent,
      async run() {
        await eventGate;
      },
    });

    let disposed = false;
    const app = defineResource({
      id: "tests-app-shutdown-lockdown",
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
      dispose: {
        drainingBudgetMs: 150,
      },
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
      id: "tests-app-shutdown-timeout-task",
      async run() {
        return new Promise<never>(() => undefined);
      },
    });

    let disposed = false;
    const app = defineResource({
      id: "tests-app-shutdown-timeout",
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
      dispose: {
        drainingBudgetMs: 20,
      },
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
      id: "tests-app-manual-dispose-lockdown-task",
      async run() {
        await taskGate;
        return "done";
      },
    });

    const slowEvent = defineEvent({
      id: "tests-app-manual-dispose-lockdown-event",
    });

    const slowHook = defineHook({
      id: "tests-app-manual-dispose-lockdown-hook",
      on: slowEvent,
      async run() {
        await eventGate;
      },
    });

    let disposed = false;
    const app = defineResource({
      id: "tests-app-manual-dispose-lockdown",
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
      dispose: {
        drainingBudgetMs: 150,
      },
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
      id: "tests-app-manual-dispose-timeout-task",
      async run() {
        return new Promise<never>(() => undefined);
      },
    });

    let disposed = false;
    const app = defineResource({
      id: "tests-app-manual-dispose-timeout",
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
      dispose: {
        drainingBudgetMs: 20,
      },
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
        id: "tests-app-shutdown-dispose-budget-cap-task",
        async run() {
          return new Promise<never>(() => undefined);
        },
      });

      let disposed = false;
      const app = defineResource({
        id: "tests-app-shutdown-dispose-budget-cap",
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
        dispose: {
          totalBudgetMs: 30,
          drainingBudgetMs: 1_000,
        },
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

  it("caps the cooldown window by remaining dispose budget", async () => {
    jest.useFakeTimers();

    try {
      let disposed = false;
      const app = defineResource({
        id: "tests-app-shutdown-cooldown-window-budget-cap",
        async init() {
          return "ok" as const;
        },
        async cooldown() {
          return;
        },
        async dispose() {
          disposed = true;
        },
      });

      const runtime = await run(app, {
        errorBoundary: false,
        shutdownHooks: false,
        dispose: {
          totalBudgetMs: 30,
          drainingBudgetMs: 0,
          cooldownWindowMs: 1_000,
        },
      });

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

  it("waits for resource disposal even when dispose budget is zero", async () => {
    let disposeCalls = 0;
    const app = defineResource({
      id: "tests-app-shutdown-dispose-budget-zero",
      async init() {
        return "ok" as const;
      },
      async dispose() {
        disposeCalls += 1;
        throw createMessageError("dispose failure");
      },
    });

    const runtime = await run(app, {
      errorBoundary: false,
      shutdownHooks: false,
      dispose: {
        totalBudgetMs: 0,
        drainingBudgetMs: 0,
      },
    });

    await expect(runtime.dispose()).rejects.toThrow("dispose failure");
    expect(disposeCalls).toBe(1);
  });

  it("waits for resource disposal even when total budget expires first", async () => {
    jest.useFakeTimers();

    let releaseCooldown: (() => void) | undefined;
    let releaseResourceDispose: (() => void) | undefined;
    let disposePromise: Promise<void> | undefined;

    try {
      let disposeStarted = false;
      let disposeCompleted = false;
      let resolveDisposeStarted: (() => void) | undefined;
      const disposeStartedPromise = new Promise<void>((resolve) => {
        resolveDisposeStarted = resolve;
      });

      const app = defineResource({
        id: "tests-app-shutdown-dispose-budget-resource-timeout",
        async init() {
          return "ok" as const;
        },
        async cooldown() {
          await new Promise<void>((resolve) => {
            releaseCooldown = resolve;
          });
        },
        async dispose() {
          disposeStarted = true;
          resolveDisposeStarted?.();
          await new Promise<void>((resolve) => {
            releaseResourceDispose = resolve;
          });
          disposeCompleted = true;
        },
      });

      const runtime = await run(app, {
        errorBoundary: false,
        shutdownHooks: false,
        dispose: {
          totalBudgetMs: 20,
          drainingBudgetMs: 0,
        },
      });

      disposePromise = runtime.dispose();
      let disposeResolved = false;
      void disposePromise.finally(() => {
        disposeResolved = true;
      });
      await flushMicrotasks();

      expect(disposeCompleted).toBe(false);
      expect(disposeStarted).toBe(false);

      jest.advanceTimersByTime(20);
      await flushMicrotasks();
      expect(disposeCompleted).toBe(false);
      expect(disposeResolved).toBe(false);
      expect(disposeStarted).toBe(false);

      if (!releaseCooldown) {
        throw createMessageError("Expected cooldown release handler");
      }

      releaseCooldown();
      await disposeStartedPromise;
      expect(disposeStarted).toBe(true);
      if (!releaseResourceDispose) {
        throw createMessageError("Expected resource dispose to begin");
      }

      releaseResourceDispose();
      await flushMicrotasks();
      await expect(disposePromise).resolves.toBeUndefined();
      expect(disposeCompleted).toBe(true);
    } finally {
      releaseCooldown?.();
      releaseResourceDispose?.();
      await disposePromise?.catch(() => undefined);
      jest.useRealTimers();
    }
  });

  it("awaits cooldown completion before emitting lifecycle events or disposing even after budget expires", async () => {
    jest.useFakeTimers();

    try {
      const lifecycle: string[] = [];

      const disposingHook = defineHook({
        id: "tests-app-shutdown-cooldown-order-disposing-hook",
        on: globalEvents.disposing,
        async run() {
          lifecycle.push("disposing");
        },
      });

      const drainedHook = defineHook({
        id: "tests-app-shutdown-cooldown-order-drained-hook",
        on: globalEvents.drained,
        async run() {
          lifecycle.push("drained");
        },
      });

      const app = defineResource({
        id: "tests-app-shutdown-cooldown-order",
        register: [disposingHook, drainedHook],
        async init() {
          return "ok" as const;
        },
        async cooldown() {
          lifecycle.push("cooldown:start");
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 40);
          });
          lifecycle.push("cooldown:end");
        },
        async dispose() {
          lifecycle.push("dispose");
        },
      });

      const runtime = await run(app, {
        errorBoundary: false,
        shutdownHooks: false,
        dispose: {
          totalBudgetMs: 20,
          drainingBudgetMs: 10,
          cooldownWindowMs: 10,
        },
      });

      const disposePromise = runtime.dispose();
      await Promise.resolve();

      jest.advanceTimersByTime(39);
      await Promise.resolve();
      expect(lifecycle).toEqual(["cooldown:start"]);

      jest.advanceTimersByTime(1);
      await Promise.resolve();
      await expect(disposePromise).resolves.toBeUndefined();
      expect(lifecycle).toEqual([
        "cooldown:start",
        "cooldown:end",
        "disposing",
        "drained",
        "dispose",
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("process signal emits disposing and allows its in-flight continuations before drain", async () => {
    const postDisposingEvent = defineEvent({
      id: "tests-app-shutdown-signal-disposing-event",
    });

    const postDisposingHandler = jest.fn();
    const postDisposingHook = defineHook({
      id: "tests-app-shutdown-signal-disposing-handler",
      on: postDisposingEvent,
      async run() {
        postDisposingHandler();
      },
    });

    const disposingHook = defineHook({
      id: "tests-app-shutdown-signal-disposing-lifecycle-hook",
      on: globalEvents.disposing,
      dependencies: {
        emitPostDisposingEvent: postDisposingEvent,
      },
      async run(_event, { emitPostDisposingEvent }) {
        await emitPostDisposingEvent(undefined);
      },
    });

    const app = defineResource({
      id: "tests-app-shutdown-signal-disposing",
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
      id: "tests-app-dispose-lifecycle-post-disposing-event",
    });

    const postDisposingHandler = defineHook({
      id: "tests-app-dispose-lifecycle-post-disposing-handler",
      on: postDisposingEvent,
      async run() {
        lifecycleOrder.push("post-disposing-event");
      },
    });

    const disposingHook = defineHook({
      id: "tests-app-dispose-lifecycle-disposing-hook",
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
      id: "tests-app-dispose-lifecycle-drained-hook",
      on: globalEvents.drained,
      async run() {
        lifecycleOrder.push("drained");
      },
    });

    const app = defineResource({
      id: "tests-app-dispose-lifecycle",
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

  it("manual dispose runs resource cooldown before disposing hooks", async () => {
    const lifecycleOrder: string[] = [];

    const disposingHook = defineHook({
      id: "tests-app-dispose-cooldown-order-disposing-hook",
      on: globalEvents.disposing,
      async run() {
        lifecycleOrder.push("disposing");
      },
    });

    const drainedHook = defineHook({
      id: "tests-app-dispose-cooldown-order-drained-hook",
      on: globalEvents.drained,
      async run() {
        lifecycleOrder.push("drained");
      },
    });

    const app = defineResource({
      id: "tests-app-dispose-cooldown-order",
      register: [disposingHook, drainedHook],
      async init() {
        return "ok";
      },
      async cooldown() {
        lifecycleOrder.push("resource-cooldown");
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
      "resource-cooldown",
      "disposing",
      "drained",
      "resource-dispose",
    ]);
  });

  it("runs cooldown before waiting for in-flight task/event drain", async () => {
    let releaseTaskGate: (() => void) | undefined;
    const taskGate = new Promise<void>((resolve) => {
      releaseTaskGate = resolve;
    });
    const lifecycleOrder: string[] = [];
    let disposed = false;

    const slowTask = defineTask({
      id: "tests-app-dispose-cooldown-before-drain-task",
      async run() {
        await taskGate;
        return "done";
      },
    });

    const app = defineResource({
      id: "tests-app-dispose-cooldown-before-drain",
      register: [slowTask],
      async init() {
        return "ok";
      },
      async cooldown() {
        lifecycleOrder.push("resource-cooldown");
      },
      async dispose() {
        disposed = true;
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
      dispose: {
        drainingBudgetMs: 150,
        cooldownWindowMs: 30,
      },
    });

    const inFlightTask = runtime.runTask(slowTask);
    await new Promise((r) => setTimeout(r, 0));

    const disposePromise = runtime.dispose();
    await new Promise((r) => setTimeout(r, 0));

    expect(lifecycleOrder).toEqual(["resource-cooldown"]);
    expect(disposed).toBe(false);

    if (!releaseTaskGate) {
      throw createMessageError("Expected slow task gate release handler");
    }

    releaseTaskGate();
    await inFlightTask;
    await disposePromise;
    expect(disposed).toBe(true);
  });

  it("logs cooldown errors and still rejects only on dispose errors", async () => {
    let disposeCalled = false;
    const logs: Array<{ level: string; message: unknown; error?: string }> = [];

    const app = defineResource({
      id: "tests-app-dispose-cooldown-errors",
      async init() {
        return "ok";
      },
      async cooldown() {
        throw createMessageError("cooldown failed");
      },
      async dispose() {
        disposeCalled = true;
        throw createMessageError("dispose failed");
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
    });
    runtime.logger.onLog((log) => {
      logs.push({
        level: log.level,
        message: log.message,
        error: log.error?.message,
      });
    });

    await expect(runtime.dispose()).rejects.toThrow(/dispose failed/);
    expect(disposeCalled).toBe(true);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          message: "Resource cooldown failed; continuing shutdown.",
          error: "cooldown failed",
        }),
      ]),
    );
  });

  it("runs cooldown once when invoked manually before dispose lifecycle", async () => {
    const cooldown = jest.fn(async () => undefined);
    const dispose = jest.fn(async () => undefined);

    const app = defineResource({
      id: "tests-app-dispose-cooldown-manual-once",
      async init() {
        return "ok";
      },
      cooldown,
      dispose,
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
    });

    await runtime.store.cooldown();
    await runtime.store.cooldown();
    expect(cooldown).toHaveBeenCalledTimes(1);

    await runtime.dispose();
    expect(cooldown).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("normalizes non-error cooldown failures in parallel waves, logs them, and still disposes", async () => {
    let firstDisposed = false;
    let secondDisposed = false;
    const logs: Array<{ level: string; error?: string }> = [];

    const first = defineResource({
      id: "tests-app-dispose-cooldown-non-error-parallel-first",
      async init() {
        return "first";
      },
      async cooldown() {
        throw "cooldown-string-failure";
      },
      async dispose() {
        firstDisposed = true;
      },
    });

    const second = defineResource({
      id: "tests-app-dispose-cooldown-non-error-parallel-second",
      async init() {
        return "second";
      },
      async cooldown() {
        return;
      },
      async dispose() {
        secondDisposed = true;
      },
    });

    const app = defineResource({
      id: "tests-app-dispose-cooldown-non-error-parallel-app",
      register: [first, second],
      async init() {
        return "app";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
      lifecycleMode: "parallel",
    });
    runtime.logger.onLog((log) => {
      logs.push({
        level: log.level,
        error: log.error?.message,
      });
    });

    await expect(runtime.dispose()).resolves.toBeUndefined();
    expect(firstDisposed).toBe(true);
    expect(secondDisposed).toBe(true);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          error: "cooldown-string-failure",
        }),
      ]),
    );
  });

  it("allows resource-origin drain work from cooldown-declared resources during disposing", async () => {
    let releaseGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let resolveTaskStarted: (() => void) | undefined;
    const taskStarted = new Promise<void>((resolve) => {
      resolveTaskStarted = resolve;
    });
    let resolveDisposingHook: (() => void) | undefined;
    const disposingHookRan = new Promise<void>((resolve) => {
      resolveDisposingHook = resolve;
    });
    const calls: string[] = [];
    const taskErrors: unknown[] = [];

    const drainTask = defineTask({
      id: "tests-app-dispose-cooldown-drain-task",
      async run() {
        calls.push("task-start");
        resolveTaskStarted?.();
        await gate;
        calls.push("task-end");
      },
    });

    const disposingHook = defineHook({
      id: "tests-app-dispose-cooldown-drain-disposing-hook",
      on: globalEvents.disposing,
      async run() {
        await new Promise((resolve) => setTimeout(resolve, 0));
        calls.push("disposing-hook");
        resolveDisposingHook?.();
      },
    });

    const drainWorker = defineResource({
      id: "tests-app-dispose-cooldown-drain-worker",
      async init() {
        return "worker";
      },
    });

    const drainingIngress = defineResource({
      id: "tests-app-dispose-cooldown-drain-resource",
      register: [drainTask, disposingHook, drainWorker],
      dependencies: {
        store: globalResources.store,
        taskRunner: globalResources.taskRunner,
      },
      async init() {
        return "ready";
      },
      async cooldown(_value, _config, deps) {
        calls.push("cooldown");
        setTimeout(() => {
          void deps.taskRunner
            .run(drainTask, undefined, {
              source: runtimeSource.resource(
                deps.store.findIdByDefinition(drainWorker),
              ),
            })
            .catch((error) => {
              taskErrors.push(error);
            });
        }, 0);
        return [drainWorker];
      },
      async dispose() {
        calls.push("dispose");
      },
    });

    const runtime = await run(drainingIngress, {
      shutdownHooks: false,
      errorBoundary: false,
      dispose: {
        drainingBudgetMs: 150,
        cooldownWindowMs: 30,
      },
    });

    const disposePromise = runtime.dispose();
    await Promise.all([taskStarted, disposingHookRan]);

    expect(taskErrors).toEqual([]);
    expect(calls).toEqual(
      expect.arrayContaining(["cooldown", "task-start", "disposing-hook"]),
    );

    if (!releaseGate) {
      throw createMessageError("Expected release gate handler");
    }

    releaseGate();
    await disposePromise;

    expect(calls).toEqual([
      "cooldown",
      "task-start",
      "disposing-hook",
      "task-end",
      "dispose",
    ]);
  });

  it("registers cooldown admission targets before disposing even when cooldown is slow", async () => {
    let releaseGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let resolveTaskStarted: (() => void) | undefined;
    const taskStarted = new Promise<void>((resolve) => {
      resolveTaskStarted = resolve;
    });
    const calls: string[] = [];
    const taskErrors: unknown[] = [];

    const drainTask = defineTask({
      id: "tests-app-dispose-cooldown-slow-drain-task",
      async run() {
        calls.push("task-start");
        resolveTaskStarted?.();
        await gate;
        calls.push("task-end");
      },
    });

    const drainWorker = defineResource({
      id: "tests-app-dispose-cooldown-slow-drain-worker",
      async init() {
        return "worker";
      },
    });

    const disposingHook = defineHook({
      id: "tests-app-dispose-cooldown-slow-disposing-hook",
      on: globalEvents.disposing,
      dependencies: {
        store: globalResources.store,
        taskRunner: globalResources.taskRunner,
      },
      async run(_event, deps) {
        await deps.taskRunner
          .run(drainTask, undefined, {
            source: runtimeSource.resource(
              deps.store.findIdByDefinition(drainWorker),
            ),
          })
          .catch((error) => {
            taskErrors.push(error);
          });
      },
    });

    const drainingIngress = defineResource({
      id: "tests-app-dispose-cooldown-slow-drain-resource",
      register: [drainTask, drainWorker, disposingHook],
      dependencies: {
        store: globalResources.store,
      },
      async init() {
        return "ready";
      },
      async cooldown() {
        calls.push("cooldown:start");
        await new Promise((resolve) => setTimeout(resolve, 30));
        calls.push("cooldown:end");
        return [drainWorker];
      },
      async dispose() {
        calls.push("dispose");
      },
    });

    const runtime = await run(drainingIngress, {
      shutdownHooks: false,
      errorBoundary: false,
      dispose: {
        totalBudgetMs: 20,
        drainingBudgetMs: 100,
      },
    });

    const disposePromise = runtime.dispose();
    await taskStarted;

    expect(taskErrors).toEqual([]);
    expect(calls).toEqual(["cooldown:start", "cooldown:end", "task-start"]);

    if (!releaseGate) {
      throw createMessageError("Expected release gate handler");
    }

    releaseGate();
    await disposePromise;

    expect(calls).toEqual([
      "cooldown:start",
      "cooldown:end",
      "task-start",
      "task-end",
      "dispose",
    ]);
  });

  it("implicitly allows the resource with cooldown() when no admission targets are returned", async () => {
    let releaseGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let resolveTaskStarted: (() => void) | undefined;
    const taskStarted = new Promise<void>((resolve) => {
      resolveTaskStarted = resolve;
    });
    const calls: string[] = [];
    const taskErrors: unknown[] = [];

    const drainTask = defineTask({
      id: "tests-app-dispose-cooldown-implicit-self-task",
      async run() {
        calls.push("task-start");
        resolveTaskStarted?.();
        await gate;
        calls.push("task-end");
      },
    });

    const disposingHook = defineHook({
      id: "tests-app-dispose-cooldown-implicit-self-disposing-hook",
      on: globalEvents.disposing,
      async run() {
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    });

    const selfDrainingResource = defineResource({
      id: "tests-app-dispose-cooldown-implicit-self-resource",
      register: [drainTask, disposingHook],
      dependencies: {
        store: globalResources.store,
        taskRunner: globalResources.taskRunner,
      },
      async init() {
        return "ready";
      },
      async cooldown(_value, _config, deps) {
        calls.push("cooldown");
        setTimeout(() => {
          void deps.taskRunner
            .run(drainTask, undefined, {
              source: runtimeSource.resource(
                deps.store.findIdByDefinition(selfDrainingResource),
              ),
            })
            .catch((error) => {
              taskErrors.push(error);
            });
        }, 0);
      },
      async dispose() {
        calls.push("dispose");
      },
    });

    const app = defineResource({
      id: "tests-app-dispose-cooldown-implicit-self",
      register: [selfDrainingResource],
      async init() {
        return "root";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
      dispose: {
        drainingBudgetMs: 150,
        cooldownWindowMs: 30,
      },
    });

    const disposePromise = runtime.dispose();
    await taskStarted;

    expect(taskErrors).toEqual([]);
    expect(calls).toEqual(["cooldown", "task-start"]);

    if (!releaseGate) {
      throw createMessageError("Expected implicit self release gate handler");
    }

    releaseGate();
    await disposePromise;

    expect(calls).toEqual(["cooldown", "task-start", "task-end", "dispose"]);
  });

  it("logs cooldown admission targets that are not part of the current runtime", async () => {
    const foreignResource = defineResource({
      id: "tests-app-dispose-cooldown-foreign-target",
      async init() {
        return "foreign";
      },
    });

    const app = defineResource({
      id: "tests-app-dispose-cooldown-invalid-target",
      async init() {
        return "ok";
      },
      async cooldown() {
        return [foreignResource];
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
    });
    const logs: Array<{ level: string; error?: string }> = [];
    runtime.logger.onLog((log) => {
      logs.push({
        level: log.level,
        error: log.error?.message,
      });
    });

    await expect(runtime.dispose()).resolves.toBeUndefined();
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          error: expect.stringMatching(/invalid cooldown admission target/i),
        }),
      ]),
    );
  });

  it("logs malformed cooldown admission targets", async () => {
    const app = defineResource({
      id: "tests-app-dispose-cooldown-malformed-target",
      async init() {
        return "ok";
      },
      async cooldown() {
        return [{} as never];
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
    });
    const logs: Array<{ level: string; error?: string }> = [];
    runtime.logger.onLog((log) => {
      logs.push({
        level: log.level,
        error: log.error?.message,
      });
    });

    await expect(runtime.dispose()).resolves.toBeUndefined();
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          error: expect.stringMatching(/invalid cooldown admission target/i),
        }),
      ]),
    );
  });
});
