import {
  defineHook,
  defineResource,
  defineTask,
  defineTaskMiddleware,
} from "../../define";
import { globalEvents } from "../../globals/globalEvents";
import { Logger } from "../../models/Logger";
import { getOrCreateTaskAbortController } from "../../models/runtime/taskCancellation";
import { getPlatform } from "../../platform";
import { run } from "../../run";

function tick(ms: number = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("run shutdown drain warning", () => {
  it("warns once when manual dispose drain times out and does so before drained hooks", async () => {
    const lifecycle: string[] = [];
    const warns: Array<{ message: unknown; data: unknown }> = [];

    const neverTask = defineTask({
      id: "tests-shutdown-drain-warning-manual-never-task",
      async run() {
        return new Promise<never>(() => undefined);
      },
    });

    const drainedHook = defineHook({
      id: "tests-shutdown-drain-warning-manual-drained-hook",
      on: globalEvents.drained,
      async run() {
        lifecycle.push("drained");
      },
    });

    const app = defineResource({
      id: "tests-shutdown-drain-warning-manual-app",
      register: [neverTask, drainedHook],
      async init() {
        return "ok";
      },
      async dispose() {
        lifecycle.push("resource-dispose");
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
      dispose: {
        drainingBudgetMs: 20,
        abortWindowMs: 0,
      },
    });

    runtime.logger.onLog((log) => {
      if (log.level === "warn") {
        lifecycle.push("warn");
        warns.push({ message: log.message, data: log.data });
      }
    });

    void runtime.runTask(neverTask);
    await tick();

    await runtime.dispose();

    expect(warns).toHaveLength(1);
    expect(String(warns[0].message)).toContain(
      "Shutdown drain did not complete within budget",
    );
    expect(warns[0].data).toMatchObject({
      reason: "drain-budget-timeout",
      requestedDrainBudgetMs: 20,
      effectiveDrainBudgetMs: 20,
    });
    expect(lifecycle).toEqual(["warn", "drained", "resource-dispose"]);
  });

  it("warns when SIGTERM shutdown drain times out", async () => {
    const warns: unknown[] = [];
    const exitSpy = jest
      .spyOn(getPlatform(), "exit")
      .mockImplementation(() => undefined);

    try {
      const neverTask = defineTask({
        id: "tests-shutdown-drain-warning-signal-never-task",
        async run() {
          return new Promise<never>(() => undefined);
        },
      });

      const app = defineResource({
        id: "tests-shutdown-drain-warning-signal-app",
        register: [neverTask],
        async init() {
          return "ok";
        },
      });

      const runtime = await run(app, {
        shutdownHooks: true,
        errorBoundary: false,
        dispose: {
          drainingBudgetMs: 20,
          abortWindowMs: 0,
        },
      });

      runtime.logger.onLog((log) => {
        if (log.level === "warn") {
          warns.push(log.data);
        }
      });

      void runtime.runTask(neverTask);
      await tick();
      process.emit("SIGTERM");
      await tick(40);

      expect(warns).toHaveLength(1);
      expect(warns[0]).toMatchObject({
        reason: "drain-budget-timeout",
      });

      await runtime.dispose();
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("aborts in-flight task signals during the abort window after drain expires", async () => {
    let taskSignal: AbortSignal | undefined;
    let releaseTaskStarted: (() => void) | undefined;
    const taskStarted = new Promise<void>((resolve) => {
      releaseTaskStarted = resolve;
    });
    const captureAbortSignalMiddleware = defineTaskMiddleware({
      id: "tests-shutdown-drain-warning-abort-signal-capture-middleware",
      async run({ next, journal, task }) {
        taskSignal = getOrCreateTaskAbortController(journal).signal;
        return next(task.input);
      },
    });

    const neverTask = defineTask({
      id: "tests-shutdown-drain-warning-abort-in-flight-task",
      middleware: [captureAbortSignalMiddleware],
      async run(_input, _deps, context) {
        releaseTaskStarted?.();
        return await new Promise<never>((_resolve, reject) => {
          context?.signal?.addEventListener(
            "abort",
            () => reject(context.signal?.reason),
            { once: true },
          );
        });
      },
    });

    const app = defineResource({
      id: "tests-shutdown-drain-warning-abort-in-flight-app",
      register: [captureAbortSignalMiddleware, neverTask],
      async init() {
        return "ok";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
      dispose: {
        drainingBudgetMs: 20,
        abortWindowMs: 20,
      },
    });

    const inFlightTask = runtime.runTask(neverTask);
    await taskStarted;

    await runtime.dispose();

    expect(taskSignal?.aborted).toBe(true);
    expect(String(taskSignal?.reason)).toContain(
      "Runtime shutdown drain budget expired",
    );
    await expect(inFlightTask).rejects.toContain(
      "Runtime shutdown drain budget expired",
    );
  });

  it("warns with drain-budget-timeout when abort window lets cooperative work settle", async () => {
    const warns: unknown[] = [];
    const captureAbortSignalMiddleware = defineTaskMiddleware({
      id: "tests-shutdown-drain-warning-abort-window-success-capture-middleware",
      async run({ next, journal, task }) {
        getOrCreateTaskAbortController(journal);
        return next(task.input);
      },
    });

    const cooperativeTask = defineTask({
      id: "tests-shutdown-drain-warning-abort-window-success-task",
      middleware: [captureAbortSignalMiddleware],
      async run(_input, _deps, context) {
        const signal = context?.signal;
        return await new Promise<never>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => {
              setTimeout(
                () => reject(signal?.reason ?? "missing abort reason"),
                5,
              );
            },
            { once: true },
          );
        });
      },
    });

    const app = defineResource({
      id: "tests-shutdown-drain-warning-abort-window-success-app",
      register: [captureAbortSignalMiddleware, cooperativeTask],
      async init() {
        return "ok";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
      dispose: {
        drainingBudgetMs: 20,
        abortWindowMs: 50,
      },
    });

    runtime.logger.onLog((log) => {
      if (log.level === "warn") {
        warns.push(log.data);
      }
    });

    const taskPromise = runtime.runTask(cooperativeTask);
    await tick();

    await runtime.dispose();

    await expect(taskPromise).rejects.toContain(
      "Runtime shutdown drain budget expired",
    );
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({
      reason: "drain-budget-timeout",
      requestedDrainBudgetMs: 20,
      effectiveDrainBudgetMs: 20,
      requestedAbortWindowMs: 50,
      effectiveAbortWindowMs: 50,
    });
  });

  it("warns with abort-window-timeout when cooperative abort does not settle in time", async () => {
    const warns: unknown[] = [];
    const captureAbortSignalMiddleware = defineTaskMiddleware({
      id: "tests-shutdown-drain-warning-abort-window-timeout-capture-middleware",
      async run({ next, journal, task }) {
        getOrCreateTaskAbortController(journal);
        return next(task.input);
      },
    });

    const neverTask = defineTask({
      id: "tests-shutdown-drain-warning-abort-window-timeout-task",
      middleware: [captureAbortSignalMiddleware],
      async run(_input, _deps, context) {
        return await new Promise<never>(() => {
          context?.signal?.addEventListener("abort", () => undefined, {
            once: true,
          });
        });
      },
    });

    const app = defineResource({
      id: "tests-shutdown-drain-warning-abort-window-timeout-app",
      register: [captureAbortSignalMiddleware, neverTask],
      async init() {
        return "ok";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
      dispose: {
        drainingBudgetMs: 20,
        abortWindowMs: 20,
      },
    });

    runtime.logger.onLog((log) => {
      if (log.level === "warn") {
        warns.push(log.data);
      }
    });

    void runtime.runTask(neverTask).catch(() => undefined);
    await tick();

    await runtime.dispose();

    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({
      reason: "abort-window-timeout",
      requestedDrainBudgetMs: 20,
      effectiveDrainBudgetMs: 20,
      requestedAbortWindowMs: 20,
      effectiveAbortWindowMs: 20,
    });
  });

  it("does not warn when in-flight work drains within budget", async () => {
    const warns: unknown[] = [];

    const quickTask = defineTask({
      id: "tests-shutdown-drain-warning-success-quick-task",
      async run() {
        await tick(5);
        return "done";
      },
    });

    const app = defineResource({
      id: "tests-shutdown-drain-warning-success-app",
      register: [quickTask],
      async init() {
        return "ok";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
      dispose: {
        drainingBudgetMs: 100,
        abortWindowMs: 0,
      },
    });

    runtime.logger.onLog((log) => {
      if (log.level === "warn") {
        warns.push(log);
      }
    });

    const inFlight = runtime.runTask(quickTask);
    await tick();
    const disposePromise = runtime.dispose();
    await inFlight;
    await disposePromise;

    expect(warns).toHaveLength(0);
  });

  it("does not warn when drain wait is disabled", async () => {
    const warns: unknown[] = [];

    const neverTask = defineTask({
      id: "tests-shutdown-drain-warning-disabled-never-task",
      async run() {
        return new Promise<never>(() => undefined);
      },
    });

    const app = defineResource({
      id: "tests-shutdown-drain-warning-disabled-app",
      register: [neverTask],
      async init() {
        return "ok";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
      dispose: {
        drainingBudgetMs: 0,
        abortWindowMs: 0,
      },
    });

    runtime.logger.onLog((log) => {
      if (log.level === "warn") {
        warns.push(log);
      }
    });

    void runtime.runTask(neverTask);
    await tick();
    await runtime.dispose();

    expect(warns).toHaveLength(0);
  });

  it("warns when cooldown consumes the remaining dispose budget before drain starts", async () => {
    const warns: unknown[] = [];

    const app = defineResource({
      id: "tests-shutdown-drain-warning-budget-exhausted-app",
      async init() {
        return "ok";
      },
      async cooldown() {
        await tick(30);
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
      dispose: {
        totalBudgetMs: 20,
        drainingBudgetMs: 50,
        abortWindowMs: 0,
      },
    });

    runtime.logger.onLog((log) => {
      if (log.level === "warn") {
        warns.push(log.data);
      }
    });

    await runtime.dispose();

    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({
      reason: "dispose-budget-exhausted-before-drain",
      requestedDrainBudgetMs: 50,
      effectiveDrainBudgetMs: 0,
      requestedAbortWindowMs: 0,
      effectiveAbortWindowMs: 0,
    });
  });

  it("warns when drain expires but no budget remains for the abort window", async () => {
    const warns: unknown[] = [];
    const captureAbortSignalMiddleware = defineTaskMiddleware({
      id: "tests-shutdown-drain-warning-abort-window-budget-exhausted-capture-middleware",
      async run({ next, journal, task }) {
        getOrCreateTaskAbortController(journal);
        return next(task.input);
      },
    });

    const neverTask = defineTask({
      id: "tests-shutdown-drain-warning-abort-window-budget-exhausted-task",
      middleware: [captureAbortSignalMiddleware],
      async run(_input, _deps, context) {
        return await new Promise<never>(() => {
          context?.signal?.addEventListener("abort", () => undefined, {
            once: true,
          });
        });
      },
    });

    const app = defineResource({
      id: "tests-shutdown-drain-warning-abort-window-budget-exhausted-app",
      register: [captureAbortSignalMiddleware, neverTask],
      async init() {
        return "ok";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
      dispose: {
        totalBudgetMs: 20,
        drainingBudgetMs: 20,
        abortWindowMs: 20,
      },
    });

    runtime.logger.onLog((log) => {
      if (log.level === "warn") {
        warns.push(log.data);
      }
    });

    void runtime.runTask(neverTask).catch(() => undefined);
    await tick();
    await runtime.dispose();

    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({
      reason: "dispose-budget-exhausted-before-abort-window",
      requestedDrainBudgetMs: 20,
      requestedAbortWindowMs: 20,
      effectiveAbortWindowMs: 0,
      effectiveDrainBudgetMs: expect.any(Number),
    });
    const effectiveDrainBudgetMs = (
      warns[0] as { effectiveDrainBudgetMs: number }
    ).effectiveDrainBudgetMs;
    expect(effectiveDrainBudgetMs).toBeGreaterThan(0);
    expect(effectiveDrainBudgetMs).toBeLessThanOrEqual(20);
  });

  it("continues disposal when warning emission fails", async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, "warn")
      .mockRejectedValueOnce(new Error("warn failed"));

    try {
      const neverTask = defineTask({
        id: "tests-shutdown-drain-warning-warn-failure-never-task",
        async run() {
          return new Promise<never>(() => undefined);
        },
      });

      const app = defineResource({
        id: "tests-shutdown-drain-warning-warn-failure-app",
        register: [neverTask],
        async init() {
          return "ok";
        },
      });

      const runtime = await run(app, {
        shutdownHooks: false,
        errorBoundary: false,
        dispose: {
          drainingBudgetMs: 20,
        },
      });

      void runtime.runTask(neverTask);
      await tick();

      await expect(runtime.dispose()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
