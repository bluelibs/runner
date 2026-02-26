import { defineHook, defineResource, defineTask } from "../../define";
import { globalEvents } from "../../globals/globalEvents";
import { Logger } from "../../models/Logger";
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
      id: "tests.shutdown-drain-warning.manual.never-task",
      async run() {
        return new Promise<never>(() => undefined);
      },
    });

    const drainedHook = defineHook({
      id: "tests.shutdown-drain-warning.manual.drained-hook",
      on: globalEvents.drained,
      async run() {
        lifecycle.push("drained");
      },
    });

    const app = defineResource({
      id: "tests.shutdown-drain-warning.manual.app",
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
      disposeDrainBudgetMs: 20,
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
        id: "tests.shutdown-drain-warning.signal.never-task",
        async run() {
          return new Promise<never>(() => undefined);
        },
      });

      const app = defineResource({
        id: "tests.shutdown-drain-warning.signal.app",
        register: [neverTask],
        async init() {
          return "ok";
        },
      });

      const runtime = await run(app, {
        shutdownHooks: true,
        errorBoundary: false,
        disposeDrainBudgetMs: 20,
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

  it("does not warn when in-flight work drains within budget", async () => {
    const warns: unknown[] = [];

    const quickTask = defineTask({
      id: "tests.shutdown-drain-warning.success.quick-task",
      async run() {
        await tick(5);
        return "done";
      },
    });

    const app = defineResource({
      id: "tests.shutdown-drain-warning.success.app",
      register: [quickTask],
      async init() {
        return "ok";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
      disposeDrainBudgetMs: 100,
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
      id: "tests.shutdown-drain-warning.disabled.never-task",
      async run() {
        return new Promise<never>(() => undefined);
      },
    });

    const app = defineResource({
      id: "tests.shutdown-drain-warning.disabled.app",
      register: [neverTask],
      async init() {
        return "ok";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
      errorBoundary: false,
      disposeDrainBudgetMs: 0,
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

  it("continues disposal when warning emission fails", async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, "warn")
      .mockRejectedValueOnce(new Error("warn failed"));

    try {
      const neverTask = defineTask({
        id: "tests.shutdown-drain-warning.warn-failure.never-task",
        async run() {
          return new Promise<never>(() => undefined);
        },
      });

      const app = defineResource({
        id: "tests.shutdown-drain-warning.warn-failure.app",
        register: [neverTask],
        async init() {
          return "ok";
        },
      });

      const runtime = await run(app, {
        shutdownHooks: false,
        errorBoundary: false,
        disposeDrainBudgetMs: 20,
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
