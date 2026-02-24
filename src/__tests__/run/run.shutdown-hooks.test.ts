import {
  defineEvent,
  defineHook,
  defineResource,
  defineTask,
} from "../../define";
import { run } from "../../run";
import { createMessageError } from "../../errors";

describe("run.ts shutdown hooks & error boundary", () => {
  const originalExit = process.exit;
  const capturedExitCalls: number[] = [];

  beforeAll(() => {
    (process as unknown as { exit: unknown }).exit = ((code?: number) => {
      capturedExitCalls.push(code ?? 0);
      return undefined as unknown as never;
    }) as unknown as never;
  });

  afterAll(() => {
    (process as unknown as { exit: unknown }).exit = originalExit;
  });

  beforeEach(() => {
    capturedExitCalls.length = 0;
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

  it("enters shutdown lockdown, blocks new work, and drains in-flight task/event work", async () => {
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
      shutdownGracePeriodMs: 150,
    });

    const inFlightTask = runtime.runTask(slowTask);
    const inFlightEvent = runtime.emitEvent(slowEvent, undefined);

    await new Promise((r) => setTimeout(r, 0));
    process.emit("SIGTERM");

    await expect(
      Promise.resolve().then(() => runtime.runTask(slowTask)),
    ).rejects.toThrow(/(shutting down|disposed)/i);
    await expect(
      Promise.resolve().then(() => runtime.emitEvent(slowEvent)),
    ).rejects.toThrow(/(shutting down|disposed)/i);

    if (!releaseTask || !releaseEvent) {
      throw createMessageError("Expected shutdown gates to be initialized");
    }
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

  it("continues shutdown after grace period expires", async () => {
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
      shutdownGracePeriodMs: 20,
    });

    void runtime.runTask(neverTask);
    await new Promise((r) => setTimeout(r, 0));
    process.emit("SIGTERM");

    await new Promise((r) => setTimeout(r, 60));

    expect(disposed).toBe(true);
    expect(capturedExitCalls[0]).toBe(0);
    await expect(
      Promise.resolve().then(() => runtime.runTask(neverTask)),
    ).rejects.toThrow(/(disposed|shutting down)/i);
    await runtime.dispose();
    await new Promise((r) => setTimeout(r, 0));
  });
});
