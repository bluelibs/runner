import { r, resources, tags } from "../../public";
import { run } from "../../run";
import { CronOnError } from "../../globals/types";
import type { RegisterableItems } from "../../defs";

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

  const createCronApp = (items: RegisterableItems[] = []) =>
    r
      .resource("app")
      .register([resources.cron, ...items])
      .build();

  const findSchedule = (
    runtime: Awaited<ReturnType<typeof run>>,
    taskId: string,
  ) =>
    Array.from(runtime.getResourceValue(resources.cron).schedules.values()).find(
      (schedule) => schedule.taskId === taskId || schedule.taskId.endsWith(taskId),
    );

  it("does not auto-register cron scheduling when resource is not registered", async () => {
    let runs = 0;

    const scheduledTask = r
      .task("app.tasks.unregistered-cron")
      .tags([tags.cron.with({ expression: "* * * * *" })])
      .run(async () => {
        runs += 1;
      })
      .build();

    const app = r.resource("app").register([scheduledTask]).build();
    const runtime = await run(app);

    jest.advanceTimersByTime(120_000);
    await flushMicrotasks();

    expect(runs).toBe(0);
    expect(() => runtime.getResourceValue(resources.cron)).toThrow();

    await runtime.dispose();
  });

  it("initializes when explicitly registered", async () => {
    const app = createCronApp();
    const runtime = await run(app);

    const cron = runtime.getResourceValue(resources.cron);
    expect(cron).toBeDefined();
    expect(cron.schedules.size).toBe(0);

    await runtime.dispose();
  });

  it("schedules a cron tagged task", async () => {
    let runs = 0;

    const scheduledTask = r
      .task("app.tasks.scheduled")
      .tags([tags.cron.with({ expression: "* * * * *" })])
      .run(async () => {
        runs += 1;
      })
      .build();

    const app = createCronApp([scheduledTask]);
    const runtime = await run(app);

    const cron = runtime.getResourceValue(resources.cron);
    expect(cron.schedules.size).toBe(1);
    expect(findSchedule(runtime, scheduledTask.id)?.stopped).toBe(false);

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

    await Promise.resolve();
    expect(runs).toBe(1);

    await runtime.dispose();
  });

  it("skips disabled schedules", async () => {
    let runs = 0;

    const disabledTask = r
      .task("app.tasks.disabled")
      .tags([
        tags.cron.with({
          expression: "* * * * *",
          enabled: false,
        }),
      ])
      .run(async () => {
        runs += 1;
      })
      .build();

    const app = createCronApp([disabledTask]);
    const runtime = await run(app);

    const cron = runtime.getResourceValue(resources.cron);
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
        tags.cron.with({
          expression: "* * * * *",
          onError: CronOnError.Stop,
        }),
      ])
      .run(async () => {
        attempts += 1;
        throw new Error("planned failure");
      })
      .build();

    const app = createCronApp([failingTask]);
    const runtime = await run(app);

    jest.advanceTimersByTime(180_000);
    await flushMicrotasks();

    expect(attempts).toBe(1);
    expect(findSchedule(runtime, failingTask.id)?.stopped).toBe(true);

    await runtime.dispose();
  });

  it("handles immediate stop when no timer exists yet", async () => {
    let attempts = 0;

    const immediateStopTask = r
      .task("app.tasks.immediate-stop")
      .tags([
        tags.cron.with({
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

    const app = createCronApp([immediateStopTask]);
    const runtime = await run(app);

    await flushMicrotasks();
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(attempts).toBe(1);
    expect(
      findSchedule(runtime, immediateStopTask.id)?.stopped,
    ).toBe(true);

    await runtime.dispose();
  });

  it("keeps schedule active after an error when onError is continue", async () => {
    let attempts = 0;

    const flakyTask = r
      .task("app.tasks.continue-on-error")
      .tags([
        tags.cron.with({
          expression: "* * * * *",
          onError: CronOnError.Continue,
        }),
      ])
      .run(async () => {
        attempts += 1;
        throw new Error("planned failure");
      })
      .build();

    const app = createCronApp([flakyTask]);
    const runtime = await run(app);

    jest.advanceTimersByTime(180_000);
    await flushMicrotasks();

    expect(attempts).toBe(1);
    expect(findSchedule(runtime, flakyTask.id)?.stopped).toBe(false);

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
      .tags([tags.cron.with({ expression: "* * * * *" })])
      .run(async () => {
        attempts += 1;
        await runtimeRef.current?.dispose();
      })
      .build();

    const app = createCronApp([selfDisposingTask]);
    runtimeRef.current = await run(app, {
      disposeDrainBudgetMs: 0,
    });

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(attempts).toBe(1);
  });
});
