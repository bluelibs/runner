import { globals, r } from "../../public";
import { run } from "../../run";
import { cronResource } from "../../globals/cron/cron.resource";
import { RunnerError } from "../../definers/defineError";

describe("global cron resource config", () => {
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

  const expectConfigValidationError = (fn: () => unknown): void => {
    try {
      fn();
      throw new Error("Expected validation error");
    } catch (error) {
      expect(error).toBeInstanceOf(RunnerError);
    }
  };

  it("filters schedules using the cron `only` config", async () => {
    let includedRuns = 0;
    let excludedRuns = 0;

    const includedTask = r
      .task("app.tasks.only.included")
      .tags([globals.tags.cron.with({ expression: "* * * * *" })])
      .run(async () => {
        includedRuns += 1;
      })
      .build();

    const excludedTask = r
      .task("app.tasks.only.excluded")
      .tags([globals.tags.cron.with({ expression: "* * * * *" })])
      .run(async () => {
        excludedRuns += 1;
      })
      .build();

    const app = r
      .resource("app")
      .register([
        globals.resources.cron.with({
          only: [includedTask, "app.tasks.only.unknown"],
        }),
        includedTask,
        excludedTask,
      ])
      .build();
    const runtime = await run(app);

    const cron = runtime.getResourceValue(globals.resources.cron);
    expect(cron.schedules.size).toBe(1);
    expect(cron.schedules.has(includedTask.id)).toBe(true);
    expect(cron.schedules.has(excludedTask.id)).toBe(false);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(includedRuns).toBe(1);
    expect(excludedRuns).toBe(0);

    await runtime.dispose();
  });

  it("does not schedule tasks when `only` is an empty array", async () => {
    let runs = 0;

    const task = r
      .task("app.tasks.only.empty")
      .tags([globals.tags.cron.with({ expression: "* * * * *" })])
      .run(async () => {
        runs += 1;
      })
      .build();

    const app = r
      .resource("app")
      .register([globals.resources.cron.with({ only: [] }), task])
      .build();
    const runtime = await run(app);

    const cron = runtime.getResourceValue(globals.resources.cron);
    expect(cron.schedules.size).toBe(0);

    jest.advanceTimersByTime(180_000);
    await flushMicrotasks();

    expect(runs).toBe(0);
    await runtime.dispose();
  });

  it("logs a warning when `only` contains unknown task ids", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const task = r
      .task("app.tasks.only.warn")
      .tags([globals.tags.cron.with({ expression: "* * * * *" })])
      .run(async () => undefined)
      .build();

    const app = r
      .resource("app")
      .register([
        globals.resources.cron.with({ only: ["app.tasks.only.miss"] }),
        task,
      ])
      .build();
    const runtime = await run(app, {
      logs: {
        printThreshold: "info",
      },
    });

    const warningCalls = errorSpy.mock.calls.filter((args) =>
      args.some(
        (value) =>
          typeof value === "string" &&
          value.includes(
            'Cron "only" filter references task "app.tasks.only.miss"',
          ),
      ),
    );
    expect(warningCalls).toHaveLength(1);

    await runtime.dispose();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("fails fast when cron resource config is not an object", async () => {
    expectConfigValidationError(() =>
      r
        .resource("app")
        .register([globals.resources.cron.with("invalid" as never)])
        .build(),
    );
  });

  it("fails fast when cron resource config `only` is not an array", async () => {
    expectConfigValidationError(() =>
      r
        .resource("app")
        .register([globals.resources.cron.with({ only: "task.id" } as never)])
        .build(),
    );
  });

  it("fails fast when cron resource config `only` entries are invalid", async () => {
    expectConfigValidationError(() =>
      r
        .resource("app")
        .register([globals.resources.cron.with({ only: [42] } as never)])
        .build(),
    );
  });

  it("fails fast when cron resource config is an array", async () => {
    expectConfigValidationError(() =>
      r
        .resource("app")
        .register([globals.resources.cron.with([] as never)])
        .build(),
    );
  });

  it("fails fast when cron resource config `only` object entry has invalid id", async () => {
    expectConfigValidationError(() =>
      r
        .resource("app")
        .register([
          globals.resources.cron.with({ only: [{ id: 123 }] } as never),
        ])
        .build(),
    );
  });

  it("parses undefined cron resource config as an empty object", () => {
    expect(cronResource.configSchema?.parse(undefined)).toEqual({});
  });

  it("accepts empty object config for cron resource", () => {
    expect(() =>
      r
        .resource("app")
        .register([globals.resources.cron.with({})])
        .build(),
    ).not.toThrow();
  });
});
