import { shutdownLockdownError } from "../../errors";
import { cronResource } from "../../globals/cron/cron.resource";
import { globalEvents } from "../../globals/globalEvents";

describe("global cron resource shutdown semantics", () => {
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

    const eventManager = {
      addListener: jest.fn(),
    };

    const taskId = "app.tasks.shutdown.immediate";
    const context = {
      disposed: false,
      stateByTaskId: new Map(),
    };

    const value = await cronResource.init?.(
      undefined,
      {
        cron: {
          tasks: [
            {
              definition: { id: taskId },
              config: { expression: "* * * * *", immediate: true },
            },
          ],
        },
        logger,
        taskRunner,
        eventManager,
      } as never,
      context as never,
    );

    await flushMicrotasks();

    expect(taskRunner.run).toHaveBeenCalledTimes(1);
    expect(value?.schedules.get(taskId)?.stopped).toBe(true);
    expect(error).toHaveBeenCalledTimes(0);
    expect(eventManager.addListener).toHaveBeenCalledWith(
      globalEvents.disposing,
      expect.any(Function),
      expect.objectContaining({ id: "globals.resources.cron.onDisposing" }),
    );
  });

  it("clears outstanding timers during dispose", async () => {
    const clearTimeoutSpy = jest
      .spyOn(globalThis, "clearTimeout")
      .mockImplementation(() => undefined);

    try {
      const timer = setTimeout(() => undefined, 1_000);
      const context = {
        disposed: false,
        stateByTaskId: new Map([
          [
            "app.tasks.timer-dispose",
            {
              task: { id: "app.tasks.timer-dispose" },
              config: { expression: "* * * * *" },
              timer,
              stopped: false,
              nextRunAt: undefined,
            },
          ],
        ]),
      };

      await cronResource.dispose?.(
        undefined as never,
        undefined as never,
        {} as never,
        context as never,
      );

      expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
      expect(context.disposed).toBe(true);
      expect(context.stateByTaskId.size).toBe(0);
    } finally {
      clearTimeoutSpy.mockRestore();
    }
  });
});
