import { shutdownLockdownError } from "../../errors";
import { CronScheduler } from "../../globals/cron/CronScheduler";
import { cronResource } from "../../globals/cron/cron.resource";

describe("global cron resource shutdown semantics", () => {
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

  it("stops immediate schedule when task runner rejects with shutdown lockdown", async () => {
    const info = jest.fn().mockResolvedValue(undefined);
    const error = jest.fn().mockResolvedValue(undefined);
    const logger = {
      with: jest.fn(() => ({
        info,
        error,
      })),
    };

    const taskRunner = {
      run: jest.fn(async () => {
        shutdownLockdownError.throw();
      }),
    };

    const taskId = "app.tasks.shutdown.immediate";
    const scheduler = new CronScheduler({
      cronTasks: [
        {
          definition: { id: taskId } as never,
          config: { expression: "* * * * *", immediate: true },
        },
      ],
      logger: logger as never,
      taskRunner: taskRunner as never,
    });
    await scheduler.start({});

    await flushMicrotasks();

    expect(taskRunner.run).toHaveBeenCalledTimes(1);
    expect(scheduler.schedules.get(taskId)?.stopped).toBe(true);
    expect(error).toHaveBeenCalledTimes(0);
  });

  it("stops all timers during cooldown", async () => {
    const info = jest.fn().mockResolvedValue(undefined);
    const warn = jest.fn().mockResolvedValue(undefined);
    const error = jest.fn().mockResolvedValue(undefined);
    const logger = {
      with: jest.fn(() => ({
        info,
        warn,
        error,
      })),
    };
    const taskRunner = {
      run: jest.fn(async () => undefined),
    };

    const clearTimeoutSpy = jest
      .spyOn(globalThis, "clearTimeout")
      .mockImplementation(() => undefined);

    try {
      const taskId = "app.tasks.timer-cooldown";
      const scheduler = new CronScheduler({
        cronTasks: [
          {
            definition: { id: taskId } as never,
            config: { expression: "* * * * *" },
          },
        ],
        logger: logger as never,
        taskRunner: taskRunner as never,
      });
      await scheduler.start({});

      await scheduler.cooldown();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(scheduler.schedules.get(taskId)?.stopped).toBe(true);

      jest.advanceTimersByTime(120_000);
      await flushMicrotasks();
      expect(taskRunner.run).toHaveBeenCalledTimes(0);
    } finally {
      clearTimeoutSpy.mockRestore();
    }
  });

  it("clears outstanding timers during dispose", async () => {
    const info = jest.fn().mockResolvedValue(undefined);
    const warn = jest.fn().mockResolvedValue(undefined);
    const error = jest.fn().mockResolvedValue(undefined);
    const logger = {
      with: jest.fn(() => ({
        info,
        warn,
        error,
      })),
    };
    const taskRunner = {
      run: jest.fn(async () => undefined),
    };

    const clearTimeoutSpy = jest
      .spyOn(globalThis, "clearTimeout")
      .mockImplementation(() => undefined);

    try {
      const scheduler = new CronScheduler({
        cronTasks: [
          {
            definition: { id: "app-tasks-timer-dispose" } as never,
            config: { expression: "* * * * *" },
          },
        ],
        logger: logger as never,
        taskRunner: taskRunner as never,
      });
      await scheduler.start({});

      await scheduler.dispose();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(scheduler.schedules.size).toBe(0);
    } finally {
      clearTimeoutSpy.mockRestore();
    }
  });

  it("cron resource cooldown is a no-op when scheduler was not initialized", async () => {
    const context = {
      scheduler: undefined,
    };

    await expect(
      cronResource.cooldown?.(
        undefined as never,
        undefined as never,
        {} as never,
        context as never,
      ),
    ).resolves.toBeUndefined();
  });

  it("cron resource dispose delegates to scheduler and clears it", async () => {
    const scheduler = {
      cooldown: jest.fn(async () => undefined),
      dispose: jest.fn(async () => undefined),
    };
    const context = {
      scheduler,
    };

    await cronResource.dispose?.(
      undefined as never,
      undefined as never,
      {} as never,
      context as never,
    );

    expect(scheduler.dispose).toHaveBeenCalledTimes(1);
    expect(context.scheduler).toBeUndefined();
  });

  it("cron resource dispose is a no-op when scheduler was not initialized", async () => {
    const context = {
      scheduler: undefined,
    };

    await expect(
      cronResource.dispose?.(
        undefined as never,
        undefined as never,
        {} as never,
        context as never,
      ),
    ).resolves.toBeUndefined();
  });
});
