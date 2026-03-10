import { r, resources, tags } from "../../public";
import { run } from "../../run";
import type { RegisterableItems } from "../../defs";

describe("global cron resource (additional)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  const flushMicrotasks = async (iterations: number = 12): Promise<void> => {
    for (let i = 0; i < iterations; i += 1) {
      await Promise.resolve();
    }
  };

  const waitFor = async (
    predicate: () => boolean,
    attempts: number = 64,
  ): Promise<void> => {
    for (let i = 0; i < attempts; i += 1) {
      if (predicate()) {
        return;
      }
      await flushMicrotasks();
    }
  };

  const createCronApp = (items: RegisterableItems[] = []) =>
    r
      .resource("app")
      .register([resources.cron, ...items])
      .build();

  it("fails fast when cron expression is invalid", async () => {
    const invalidTask = r
      .task("app-tasks-invalid-cron")
      .tags([tags.cron.with({ expression: "invalid" })])
      .run(async () => undefined)
      .build();

    const app = createCronApp([invalidTask]);

    await expect(run(app)).rejects.toThrow(
      /invalid cron expression configuration/i,
    );
  });

  it("handles non-Error task failures while keeping schedule active", async () => {
    let attempts = 0;

    const flakyTask = r
      .task("app-tasks-non-error-failure")
      .tags([
        tags.cron.with({
          expression: "* * * * *",
        }),
      ])
      .run(async () => {
        attempts += 1;
        throw "string failure";
      })
      .build();

    const app = createCronApp([flakyTask]);
    const runtime = await run(app);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(attempts).toBe(1);
    expect(
      runtime.getResourceValue(resources.cron).schedules.values().next().value
        ?.stopped,
    ).toBe(false);

    await runtime.dispose();
  });

  it("fails when a task declares multiple cron tags", async () => {
    const duplicateCronTask = r
      .task("app-tasks-duplicate-cron")
      .tags([
        tags.cron.with({ expression: "* * * * *" }),
        tags.cron.with({ expression: "*/5 * * * *" }),
      ])
      .run(async () => undefined)
      .build();

    const app = createCronApp([duplicateCronTask]);
    await expect(run(app)).rejects.toThrow(
      /duplicate tag "runner\.tags\.cron"/i,
    );
  });

  it("fails when cron tag is present without configuration", async () => {
    const missingConfigTask = r
      .task("app-tasks-missing-cron-config")
      .tags([tags.cron as never])
      .run(async () => undefined)
      .build();

    const app = createCronApp([missingConfigTask]);
    await expect(run(app)).rejects.toThrow(/missing configuration/i);
  });

  it("cleans up schedules on dispose", async () => {
    let attempts = 0;
    const clearTimeoutSpy = jest
      .spyOn(globalThis, "clearTimeout")
      .mockImplementation(() => undefined);

    const scheduledTask = r
      .task("app-tasks-cleanup")
      .tags([tags.cron.with({ expression: "* * * * *" })])
      .run(async () => {
        attempts += 1;
      })
      .build();

    const app = createCronApp([scheduledTask]);
    const runtime = await run(app);
    const cron = runtime.getResourceValue(resources.cron);

    expect(cron.schedules.size).toBe(1);
    await runtime.dispose();
    expect(cron.schedules.size).toBe(0);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(attempts).toBe(0);
  });

  it("stops a pending schedule without failure logs when runtime is disposing", async () => {
    let cronRuns = 0;
    let releaseBlocker!: () => void;
    const blockerGate = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const clearTimeoutSpy = jest
      .spyOn(globalThis, "clearTimeout")
      .mockImplementation(() => undefined);

    const blockerTask = r
      .task("app-tasks-shutdown-blocker")
      .run(async () => {
        await blockerGate;
      })
      .build();

    const shutdownAwareCronTask = r
      .task("app-tasks-shutdown-cron")
      .tags([tags.cron.with({ expression: "* * * * *" })])
      .run(async () => {
        cronRuns += 1;
      })
      .build();

    const app = createCronApp([blockerTask, shutdownAwareCronTask]);
    const runtime = await run(app, {
      dispose: {
        totalBudgetMs: 1_000_000,
        drainingBudgetMs: 1_000_000,
      },
    });
    const cron = runtime.getResourceValue(resources.cron);
    const getShutdownSchedule = () =>
      Array.from(cron.schedules.values()).find(
        (schedule) =>
          schedule.taskId === shutdownAwareCronTask.id ||
          schedule.taskId.endsWith(shutdownAwareCronTask.id),
      );

    const blockerRun = runtime.runTask(blockerTask);
    await flushMicrotasks();

    const disposePromise = runtime.dispose();
    await flushMicrotasks();
    await waitFor(() => getShutdownSchedule()?.stopped === true);

    expect(getShutdownSchedule()?.stopped).toBe(true);
    expect(clearTimeoutSpy).toHaveBeenCalled();

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(cronRuns).toBe(0);

    const cronErrors = errorSpy.mock.calls.filter((args) =>
      args.some(
        (value) =>
          typeof value === "string" &&
          value.includes("app-tasks-shutdown-cron"),
      ),
    );
    expect(cronErrors).toHaveLength(0);

    releaseBlocker();
    await blockerRun;
    await disposePromise;
    errorSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  it("suppresses all log output when silent is true", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    let attempts = 0;

    const silentTask = r
      .task("app-tasks-silent")
      .tags([
        tags.cron.with({
          expression: "* * * * *",
          silent: true,
        }),
      ])
      .run(async () => {
        attempts += 1;
        throw new Error("silent failure");
      })
      .build();

    const app = createCronApp([silentTask]);
    const runtime = await run(app);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(attempts).toBe(1);

    const cronLogs = [
      ...logSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
    ].filter((args) =>
      args.some((a) => typeof a === "string" && a.includes("app-tasks-silent")),
    );
    expect(cronLogs).toHaveLength(0);

    await runtime.dispose();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("suppresses disabled-task log when silent is true", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    const disabledSilentTask = r
      .task("app-tasks-disabled-silent")
      .tags([
        tags.cron.with({
          expression: "* * * * *",
          enabled: false,
          silent: true,
        }),
      ])
      .run(async () => undefined)
      .build();

    const app = createCronApp([disabledSilentTask]);
    const runtime = await run(app);

    const cronLogs = logSpy.mock.calls.filter((args) =>
      args.some(
        (a) => typeof a === "string" && a.includes("app-tasks-disabled-silent"),
      ),
    );
    expect(cronLogs).toHaveLength(0);

    await runtime.dispose();
    logSpy.mockRestore();
  });

  it("runs immediate tasks once per interval after startup", async () => {
    let runs = 0;

    const immediateTask = r
      .task("app-tasks-immediate-single-stream")
      .tags([
        tags.cron.with({
          expression: "* * * * *",
          immediate: true,
        }),
      ])
      .run(async () => {
        runs += 1;
      })
      .build();

    const app = createCronApp([immediateTask]);
    const runtime = await run(app);

    await flushMicrotasks();
    expect(runs).toBe(1);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();
    expect(runs).toBe(2);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();
    expect(runs).toBe(3);

    await runtime.dispose();
  });

  it("schedules multiple cron tasks independently", async () => {
    let immediateRuns = 0;
    let regularRuns = 0;

    const immediateTask = r
      .task("app-tasks-multi-immediate")
      .tags([
        tags.cron.with({
          expression: "* * * * *",
          immediate: true,
        }),
      ])
      .run(async () => {
        immediateRuns += 1;
      })
      .build();

    const regularTask = r
      .task("app-tasks-multi-regular")
      .tags([tags.cron.with({ expression: "* * * * *" })])
      .run(async () => {
        regularRuns += 1;
      })
      .build();

    const app = createCronApp([immediateTask, regularTask]);
    const runtime = await run(app);

    await flushMicrotasks();
    expect(immediateRuns).toBe(1);
    expect(regularRuns).toBe(0);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();
    expect(immediateRuns).toBe(2);
    expect(regularRuns).toBe(1);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();
    expect(immediateRuns).toBe(3);
    expect(regularRuns).toBe(2);

    await runtime.dispose();
  });
});
