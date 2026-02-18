import { globals, r } from "../../public";
import { CronOnError } from "../../globals/types";
import { run } from "../../run";

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

  it("fails fast when cron expression is invalid", async () => {
    const invalidTask = r
      .task("app.tasks.invalid-cron")
      .tags([globals.tags.cron.with({ expression: "invalid" })])
      .run(async () => undefined)
      .build();

    const app = r.resource("app").register([invalidTask]).build();

    await expect(run(app)).rejects.toThrow(
      /invalid cron expression configuration/i,
    );
  });

  it("handles non-Error task failures while keeping schedule active", async () => {
    let attempts = 0;

    const flakyTask = r
      .task("app.tasks.non-error-failure")
      .tags([
        globals.tags.cron.with({
          expression: "* * * * *",
        }),
      ])
      .run(async () => {
        attempts += 1;
        throw "string failure";
      })
      .build();

    const app = r.resource("app").register([flakyTask]).build();
    const runtime = await run(app);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(attempts).toBe(1);
    expect(
      runtime
        .getResourceValue(globals.resources.cron)
        .schedules.get("app.tasks.non-error-failure")?.stopped,
    ).toBe(false);

    await runtime.dispose();
  });

  it("ignores already-stopped task executions when an orphaned callback runs", async () => {
    let attempts = 0;

    const clearTimeoutSpy = jest
      .spyOn(globalThis, "clearTimeout")
      .mockImplementation(() => undefined);

    const stopTask = r
      .task("app.tasks.stop-guard")
      .tags([
        globals.tags.cron.with({
          expression: "* * * * *",
          immediate: true,
          onError: CronOnError.Stop,
        }),
      ])
      .run(async () => {
        attempts += 1;
        throw new Error("planned stop");
      })
      .build();

    const app = r.resource("app").register([stopTask]).build();
    const runtime = await run(app);

    await flushMicrotasks();
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(attempts).toBe(1);

    await runtime.dispose();
  });

  it("fails when a task declares multiple cron tags", async () => {
    const duplicateCronTask = r
      .task("app.tasks.duplicate-cron")
      .tags([
        globals.tags.cron.with({ expression: "* * * * *" }),
        globals.tags.cron.with({ expression: "*/5 * * * *" }),
      ])
      .run(async () => undefined)
      .build();

    const app = r.resource("app").register([duplicateCronTask]).build();
    await expect(run(app)).rejects.toThrow(
      /duplicate tag "globals\.tags\.cron"/i,
    );
  });

  it("fails when cron tag is present without configuration", async () => {
    const missingConfigTask = r
      .task("app.tasks.missing-cron-config")
      .tags([globals.tags.cron as never])
      .run(async () => undefined)
      .build();

    const app = r.resource("app").register([missingConfigTask]).build();
    await expect(run(app)).rejects.toThrow(/missing configuration/i);
  });

  it("cleans up schedules on dispose", async () => {
    const scheduledTask = r
      .task("app.tasks.cleanup")
      .tags([globals.tags.cron.with({ expression: "* * * * *" })])
      .run(async () => undefined)
      .build();

    const app = r.resource("app").register([scheduledTask]).build();
    const runtime = await run(app);
    const cron = runtime.getResourceValue(globals.resources.cron);

    expect(cron.schedules.size).toBe(1);
    await runtime.dispose();
    expect(cron.schedules.size).toBe(0);
  });

  it("suppresses all log output when silent is true", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    let attempts = 0;

    const silentTask = r
      .task("app.tasks.silent")
      .tags([
        globals.tags.cron.with({
          expression: "* * * * *",
          silent: true,
        }),
      ])
      .run(async () => {
        attempts += 1;
        throw new Error("silent failure");
      })
      .build();

    const app = r.resource("app").register([silentTask]).build();
    const runtime = await run(app);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(attempts).toBe(1);

    const cronLogs = [
      ...logSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
    ].filter((args) =>
      args.some((a) => typeof a === "string" && a.includes("app.tasks.silent")),
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
      .task("app.tasks.disabled-silent")
      .tags([
        globals.tags.cron.with({
          expression: "* * * * *",
          enabled: false,
          silent: true,
        }),
      ])
      .run(async () => undefined)
      .build();

    const app = r.resource("app").register([disabledSilentTask]).build();
    const runtime = await run(app);

    const cronLogs = logSpy.mock.calls.filter((args) =>
      args.some(
        (a) => typeof a === "string" && a.includes("app.tasks.disabled-silent"),
      ),
    );
    expect(cronLogs).toHaveLength(0);

    await runtime.dispose();
    logSpy.mockRestore();
  });
});
