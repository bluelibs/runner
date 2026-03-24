import { globalEvents } from "../../globals/globalEvents";
import { runtimeSource } from "../../types/runtimeSource";
import { ForceDisposalController } from "../../tools/ForceDisposalController";
import { runShutdownDisposalLifecycle } from "../../tools/shutdownDisposalLifecycle";

function createLifecycleInput(options?: {
  dispose?: Partial<{
    totalBudgetMs: number;
    drainingBudgetMs: number;
    abortWindowMs: number;
    cooldownWindowMs: number;
  }>;
}) {
  const calls: string[] = [];
  const forceDisposal = new ForceDisposalController();
  const resolveRegisteredDefinition = jest.fn(
    <TDefinition extends { id: string }>(definition: TDefinition) => definition,
  );

  const store = {
    beginCoolingDown: jest.fn(() => {
      calls.push("beginCoolingDown");
    }),
    beginDisposing: jest.fn(() => {
      calls.push("beginDisposing");
    }),
    cooldown: jest.fn(async () => {
      calls.push("cooldown");
    }),
    beginDrained: jest.fn(() => {
      calls.push("beginDrained");
    }),
    waitForDrain: jest.fn(async () => {
      calls.push("waitForDrain");
      return true;
    }),
    abortInFlightTaskSignals: jest.fn((reason: string) => {
      calls.push(`abort:${reason}`);
    }),
    resolveRegisteredDefinition,
  };

  const eventManager = {
    emitLifecycle: jest.fn(async (eventDefinition: { id: string }) => {
      calls.push(`emit:${eventDefinition.id}`);
    }),
  };

  return {
    calls,
    forceDisposal,
    store,
    eventManager,
    warn: jest.fn(async () => {}),
    input: {
      store,
      eventManager,
      runLogger: { warn: jest.fn(async () => {}) } as any,
      runtimeLifecycleSource: runtimeSource.runtime("runtime-test"),
      dispose: {
        totalBudgetMs: 30_000,
        drainingBudgetMs: 20_000,
        abortWindowMs: 0,
        cooldownWindowMs: 0,
        ...(options?.dispose ?? {}),
      },
      forceDisposal,
      disposeAll: jest.fn(async () => {
        calls.push("disposeAll");
      }),
    },
  };
}

describe("ForceDisposalController", () => {
  it("resolves its request promise only once", async () => {
    const controller = new ForceDisposalController();
    const onRequested = jest.fn();

    void controller.whenRequested.then(onRequested);

    controller.request();
    controller.request();
    await Promise.resolve();

    expect(controller.isRequested).toBe(true);
    expect(onRequested).toHaveBeenCalledTimes(1);
  });
});

describe("runShutdownDisposalLifecycle force handling", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("jumps straight to disposal when force was already requested", async () => {
    const { calls, forceDisposal, input } = createLifecycleInput();

    forceDisposal.request();
    await runShutdownDisposalLifecycle(input);

    expect(calls).toEqual(["beginDisposing", "disposeAll"]);
  });

  it("switches to direct disposal when force arrives during cooldownWindowMs", async () => {
    jest.useFakeTimers();

    const context = createLifecycleInput({
      dispose: { cooldownWindowMs: 100 },
    });

    context.store.cooldown.mockImplementation(async () => {
      context.calls.push("cooldown");
      setTimeout(() => context.forceDisposal.request(), 10);
    });

    const shutdownPromise = runShutdownDisposalLifecycle(context.input);
    await jest.advanceTimersByTimeAsync(10);
    await shutdownPromise;

    expect(context.calls).toEqual([
      "beginCoolingDown",
      "cooldown",
      "beginDisposing",
      "disposeAll",
    ]);
  });

  it("switches to direct disposal when cooldown itself requests force", async () => {
    const context = createLifecycleInput();

    context.store.cooldown.mockImplementation(async () => {
      context.calls.push("cooldown");
      context.forceDisposal.request();
    });

    await runShutdownDisposalLifecycle(context.input);

    expect(context.calls).toEqual([
      "beginCoolingDown",
      "cooldown",
      "beginDisposing",
      "disposeAll",
    ]);
  });

  it("switches to direct disposal when force is requested right after beginDisposing", async () => {
    const context = createLifecycleInput();

    context.store.beginDisposing.mockImplementation(() => {
      context.calls.push("beginDisposing");
      context.forceDisposal.request();
    });

    await runShutdownDisposalLifecycle(context.input);

    expect(context.calls).toEqual([
      "beginCoolingDown",
      "cooldown",
      "beginDisposing",
      "beginDisposing",
      "disposeAll",
    ]);
  });

  it("switches to direct disposal when force is requested after events.disposing", async () => {
    const context = createLifecycleInput();

    context.eventManager.emitLifecycle.mockImplementation(
      async (eventDefinition: { id: string }) => {
        context.calls.push(`emit:${eventDefinition.id}`);
        if (eventDefinition.id === globalEvents.disposing.id) {
          context.forceDisposal.request();
        }
      },
    );

    await runShutdownDisposalLifecycle(context.input);

    expect(context.calls).toEqual([
      "beginCoolingDown",
      "cooldown",
      "beginDisposing",
      `emit:${globalEvents.disposing.id}`,
      "beginDisposing",
      "disposeAll",
    ]);
  });

  it("switches to direct disposal when force is requested after drain wait", async () => {
    const context = createLifecycleInput();

    context.store.waitForDrain.mockImplementation(async () => {
      context.calls.push("waitForDrain");
      context.forceDisposal.request();
      return false;
    });

    await runShutdownDisposalLifecycle(context.input);

    expect(context.calls).toEqual([
      "beginCoolingDown",
      "cooldown",
      "beginDisposing",
      `emit:${globalEvents.disposing.id}`,
      "waitForDrain",
      "beginDisposing",
      "disposeAll",
    ]);
  });

  it("switches to direct disposal when force is requested during the abort window", async () => {
    const context = createLifecycleInput({
      dispose: {
        abortWindowMs: 20,
      },
    });

    context.store.waitForDrain
      .mockImplementationOnce(async () => {
        context.calls.push("waitForDrain");
        return false;
      })
      .mockImplementationOnce(async () => {
        context.calls.push("waitForDrain");
        context.forceDisposal.request();
        return false;
      });

    await runShutdownDisposalLifecycle(context.input);

    expect(context.calls).toEqual([
      "beginCoolingDown",
      "cooldown",
      "beginDisposing",
      `emit:${globalEvents.disposing.id}`,
      "waitForDrain",
      "abort:Runtime shutdown drain budget expired",
      "waitForDrain",
      "beginDisposing",
      "disposeAll",
    ]);
  });

  it("switches to direct disposal when force is requested after events.drained", async () => {
    const context = createLifecycleInput();

    context.eventManager.emitLifecycle.mockImplementation(
      async (eventDefinition: { id: string }) => {
        context.calls.push(`emit:${eventDefinition.id}`);
        if (eventDefinition.id === globalEvents.drained.id) {
          context.forceDisposal.request();
        }
      },
    );

    await runShutdownDisposalLifecycle(context.input);

    expect(context.calls).toEqual([
      "beginCoolingDown",
      "cooldown",
      "beginDisposing",
      `emit:${globalEvents.disposing.id}`,
      "waitForDrain",
      "beginDrained",
      `emit:${globalEvents.drained.id}`,
      "beginDisposing",
      "disposeAll",
    ]);
  });

  it("aborts in-flight task signals before drained hooks when drain wait times out", async () => {
    const context = createLifecycleInput({
      dispose: {
        abortWindowMs: 20,
      },
    });

    context.store.waitForDrain.mockImplementation(async () => {
      context.calls.push("waitForDrain");
      return false;
    });

    await runShutdownDisposalLifecycle(context.input);

    expect(context.calls).toEqual([
      "beginCoolingDown",
      "cooldown",
      "beginDisposing",
      `emit:${globalEvents.disposing.id}`,
      "waitForDrain",
      "abort:Runtime shutdown drain budget expired",
      "waitForDrain",
      "beginDrained",
      `emit:${globalEvents.drained.id}`,
      "disposeAll",
    ]);
  });

  it("waits the abort window after drain timeout when configured", async () => {
    const context = createLifecycleInput({
      dispose: {
        abortWindowMs: 15,
      },
    });

    context.store.waitForDrain
      .mockImplementationOnce(async () => {
        context.calls.push("waitForDrain");
        return false;
      })
      .mockImplementationOnce(async () => {
        context.calls.push("waitForDrain");
        return true;
      });

    await runShutdownDisposalLifecycle(context.input);

    expect(context.calls).toEqual([
      "beginCoolingDown",
      "cooldown",
      "beginDisposing",
      `emit:${globalEvents.disposing.id}`,
      "waitForDrain",
      "abort:Runtime shutdown drain budget expired",
      "waitForDrain",
      "beginDrained",
      `emit:${globalEvents.drained.id}`,
      "disposeAll",
    ]);
  });

  it("continues disposal when warning emission fails after aborting in-flight task signals", async () => {
    const context = createLifecycleInput({
      dispose: {
        abortWindowMs: 20,
      },
    });

    context.store.waitForDrain.mockImplementation(async () => {
      context.calls.push("waitForDrain");
      return false;
    });
    context.input.runLogger = {
      warn: jest.fn(async () => {
        throw new Error("warn failed");
      }),
    } as any;

    await runShutdownDisposalLifecycle(context.input);

    expect(context.calls).toEqual([
      "beginCoolingDown",
      "cooldown",
      "beginDisposing",
      `emit:${globalEvents.disposing.id}`,
      "waitForDrain",
      "abort:Runtime shutdown drain budget expired",
      "waitForDrain",
      "beginDrained",
      `emit:${globalEvents.drained.id}`,
      "disposeAll",
    ]);
  });

  it("does not abort in-flight task signals when no effective drain budget remains", async () => {
    jest.useFakeTimers();

    const context = createLifecycleInput({
      dispose: {
        totalBudgetMs: 20,
        drainingBudgetMs: 50,
      },
    });

    context.store.cooldown.mockImplementation(async () => {
      context.calls.push("cooldown");
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    const shutdownPromise = runShutdownDisposalLifecycle(context.input);
    await jest.advanceTimersByTimeAsync(30);
    await shutdownPromise;

    expect(context.calls).toEqual([
      "beginCoolingDown",
      "cooldown",
      "beginDisposing",
      `emit:${globalEvents.disposing.id}`,
      "beginDrained",
      `emit:${globalEvents.drained.id}`,
      "disposeAll",
    ]);
    expect(context.store.abortInFlightTaskSignals).not.toHaveBeenCalled();
  });

  it("skips the abort window when the drain wait uses up the remaining disposal budget", async () => {
    jest.useFakeTimers();

    const context = createLifecycleInput({
      dispose: {
        totalBudgetMs: 20,
        drainingBudgetMs: 20,
        abortWindowMs: 20,
      },
    });

    context.store.waitForDrain.mockImplementation(async () => {
      context.calls.push("waitForDrain");
      await new Promise((resolve) => setTimeout(resolve, 25));
      return false;
    });

    const shutdownPromise = runShutdownDisposalLifecycle(context.input);
    await jest.advanceTimersByTimeAsync(25);
    await shutdownPromise;

    expect(context.calls).toContain("waitForDrain");
    expect(context.calls).toContain(`emit:${globalEvents.disposing.id}`);
    expect(context.calls).toContain(`emit:${globalEvents.drained.id}`);
    expect(context.calls).toContain("disposeAll");
    expect(
      context.calls.filter((call) => call === "waitForDrain"),
    ).toHaveLength(1);
    expect(context.store.abortInFlightTaskSignals).not.toHaveBeenCalled();
  });

  it("does not start an abort window when drain completes gracefully", async () => {
    const context = createLifecycleInput({
      dispose: {
        abortWindowMs: 20,
      },
    });

    context.store.waitForDrain.mockImplementation(async () => {
      context.calls.push("waitForDrain");
      return true;
    });

    await runShutdownDisposalLifecycle(context.input);

    expect(context.calls).toEqual([
      "beginCoolingDown",
      "cooldown",
      "beginDisposing",
      `emit:${globalEvents.disposing.id}`,
      "waitForDrain",
      "beginDrained",
      `emit:${globalEvents.drained.id}`,
      "disposeAll",
    ]);
    expect(context.store.abortInFlightTaskSignals).not.toHaveBeenCalled();
  });

  it("ignores late force requests after cooldownWindowMs already finished", async () => {
    jest.useFakeTimers();

    const context = createLifecycleInput({
      dispose: { cooldownWindowMs: 5, drainingBudgetMs: 0 },
    });

    const shutdownPromise = runShutdownDisposalLifecycle(context.input);
    await jest.advanceTimersByTimeAsync(5);
    await shutdownPromise;

    context.forceDisposal.request();
    await Promise.resolve();

    expect(context.calls).toEqual([
      "beginCoolingDown",
      "cooldown",
      "beginDisposing",
      `emit:${globalEvents.disposing.id}`,
      "beginDrained",
      `emit:${globalEvents.drained.id}`,
      "disposeAll",
    ]);
  });
});
