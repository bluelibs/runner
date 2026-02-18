import { globals, r } from "../../public";
import { run } from "../../run";
import { CronOnError } from "../../globals/types";

describe("global cron resource", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const flushMicrotasks = async (iterations: number = 12): Promise<void> => {
    for (let i = 0; i < iterations; i += 1) {
      await Promise.resolve();
    }
  };

  it("is globally registered and auto-initialized", async () => {
    const app = r.resource("app").build();
    const runtime = await run(app);

    const cron = runtime.getResourceValue(globals.resources.cron);
    expect(cron).toBeDefined();
    expect(cron.schedules.size).toBe(0);

    await runtime.dispose();
  });

  it("schedules a cron tagged task", async () => {
    let runs = 0;

    const scheduledTask = r
      .task("app.tasks.scheduled")
      .tags([globals.tags.cron.with({ expression: "* * * * *" })])
      .run(async () => {
        runs += 1;
      })
      .build();

    const app = r.resource("app").register([scheduledTask]).build();
    const runtime = await run(app);

    const cron = runtime.getResourceValue(globals.resources.cron);
    expect(cron.schedules.size).toBe(1);
    expect(cron.schedules.get("app.tasks.scheduled")?.stopped).toBe(false);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(runs).toBe(1);
    await runtime.dispose();
  });

  it("runs immediately when immediate is enabled", async () => {
    let runs = 0;

    const immediateTask = r
      .task("app.tasks.immediate")
      .tags([
        globals.tags.cron.with({
          expression: "* * * * *",
          immediate: true,
        }),
      ])
      .run(async () => {
        runs += 1;
      })
      .build();

    const app = r.resource("app").register([immediateTask]).build();
    const runtime = await run(app);

    await Promise.resolve();
    expect(runs).toBe(1);

    await runtime.dispose();
  });

  it("skips disabled schedules", async () => {
    let runs = 0;

    const disabledTask = r
      .task("app.tasks.disabled")
      .tags([
        globals.tags.cron.with({
          expression: "* * * * *",
          enabled: false,
        }),
      ])
      .run(async () => {
        runs += 1;
      })
      .build();

    const app = r.resource("app").register([disabledTask]).build();
    const runtime = await run(app);

    const cron = runtime.getResourceValue(globals.resources.cron);
    expect(cron.schedules.size).toBe(0);

    for (let i = 0; i < 3; i += 1) {
      jest.advanceTimersByTime(60_000);
      await flushMicrotasks();
    }

    expect(runs).toBe(0);
    await runtime.dispose();
  });

  it("stops schedule after an error when onError is stop", async () => {
    let attempts = 0;

    const failingTask = r
      .task("app.tasks.stop-on-error")
      .tags([
        globals.tags.cron.with({
          expression: "* * * * *",
          onError: CronOnError.Stop,
        }),
      ])
      .run(async () => {
        attempts += 1;
        throw new Error("planned failure");
      })
      .build();

    const app = r.resource("app").register([failingTask]).build();
    const runtime = await run(app);

    jest.advanceTimersByTime(180_000);
    await flushMicrotasks();

    expect(attempts).toBe(1);
    const cron = runtime.getResourceValue(globals.resources.cron);
    expect(cron.schedules.get("app.tasks.stop-on-error")?.stopped).toBe(true);

    await runtime.dispose();
  });

  it("handles immediate stop when no timer exists yet", async () => {
    let attempts = 0;

    const immediateStopTask = r
      .task("app.tasks.immediate-stop")
      .tags([
        globals.tags.cron.with({
          expression: "* * * * *",
          immediate: true,
          onError: CronOnError.Stop,
        }),
      ])
      .run(async () => {
        attempts += 1;
        throw new Error("planned immediate failure");
      })
      .build();

    const app = r.resource("app").register([immediateStopTask]).build();
    const runtime = await run(app);

    await flushMicrotasks();
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(attempts).toBe(1);
    expect(
      runtime
        .getResourceValue(globals.resources.cron)
        .schedules.get("app.tasks.immediate-stop")?.stopped,
    ).toBe(true);

    await runtime.dispose();
  });

  it("keeps schedule active after an error when onError is continue", async () => {
    let attempts = 0;

    const flakyTask = r
      .task("app.tasks.continue-on-error")
      .tags([
        globals.tags.cron.with({
          expression: "* * * * *",
          onError: CronOnError.Continue,
        }),
      ])
      .run(async () => {
        attempts += 1;
        throw new Error("planned failure");
      })
      .build();

    const app = r.resource("app").register([flakyTask]).build();
    const runtime = await run(app);

    jest.advanceTimersByTime(180_000);
    await flushMicrotasks();

    expect(attempts).toBe(1);
    const cron = runtime.getResourceValue(globals.resources.cron);
    expect(cron.schedules.get("app.tasks.continue-on-error")?.stopped).toBe(
      false,
    );

    await runtime.dispose();
  });

  it("does not reschedule after runtime is disposed during task execution", async () => {
    let attempts = 0;
    const runtimeRef: {
      current: Awaited<ReturnType<typeof run>> | undefined;
    } = {
      current: undefined,
    };

    const selfDisposingTask = r
      .task("app.tasks.self-dispose")
      .tags([globals.tags.cron.with({ expression: "* * * * *" })])
      .run(async () => {
        attempts += 1;
        await runtimeRef.current?.dispose();
      })
      .build();

    const app = r.resource("app").register([selfDisposingTask]).build();
    runtimeRef.current = await run(app);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(attempts).toBe(1);
  });
});
