import { RuntimeRecoveryController } from "../../../models/runtime/RuntimeRecoveryController";
import { RuntimeTimers } from "../../../models/runtime/RuntimeTimers";
import type { RuntimeState } from "../../../types/runner";

describe("RuntimeRecoveryController", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("rejects recovery registration unless the runtime is paused", () => {
    let state: RuntimeState = "running";
    const timers = new RuntimeTimers(async () => undefined);
    const controller = new RuntimeRecoveryController({
      getRuntimeState: () => state,
      getTimers: () => timers,
      isShuttingDown: () => false,
      onResume: () => {
        state = "running";
      },
      onUnhandledError: async () => undefined,
    });

    expect(() =>
      controller.recoverWhen({
        everyMs: 10,
        check: () => true,
      }),
    ).toThrow("runtime.recoverWhen() requires the runtime to be paused.");
  });

  it("auto-resumes only after all active recovery checks pass", async () => {
    jest.useFakeTimers();

    let state: RuntimeState = "paused";
    let allowA = false;
    let allowB = false;
    let resumeCount = 0;

    const timers = new RuntimeTimers(async () => undefined);
    const controller = new RuntimeRecoveryController({
      getRuntimeState: () => state,
      getTimers: () => timers,
      isShuttingDown: () => false,
      onResume: () => {
        resumeCount += 1;
        state = "running";
      },
      onUnhandledError: async () => undefined,
    });

    controller.beginPauseEpisode();
    controller.recoverWhen({
      id: "a",
      everyMs: 10,
      check: async () => allowA,
    });
    controller.recoverWhen({
      id: "b",
      everyMs: 10,
      check: async () => allowB,
    });

    await Promise.resolve();
    expect(resumeCount).toBe(0);

    allowA = true;
    await jest.advanceTimersByTimeAsync(10);
    expect(resumeCount).toBe(0);

    allowB = true;
    await jest.advanceTimersByTimeAsync(10);
    expect(resumeCount).toBe(1);
    expect(state).toBe("running");
  });

  it("clears active registrations when manually resumed", async () => {
    jest.useFakeTimers();

    let state: RuntimeState = "paused";
    let checks = 0;

    const timers = new RuntimeTimers(async () => undefined);
    const controller = new RuntimeRecoveryController({
      getRuntimeState: () => state,
      getTimers: () => timers,
      isShuttingDown: () => false,
      onResume: () => {
        state = "running";
      },
      onUnhandledError: async () => undefined,
    });

    controller.beginPauseEpisode();
    controller.recoverWhen({
      everyMs: 10,
      check: async () => {
        checks += 1;
        return false;
      },
    });

    await Promise.resolve();
    expect(checks).toBe(1);

    controller.resumeCurrentEpisode();
    await jest.advanceTimersByTimeAsync(50);
    expect(checks).toBe(1);
  });

  it("replaces same-id registrations and reports thrown recovery checks", async () => {
    jest.useFakeTimers();

    let state: RuntimeState = "paused";
    const onUnhandledError = jest.fn(async () => undefined);
    const timers = new RuntimeTimers(onUnhandledError);
    const controller = new RuntimeRecoveryController({
      getRuntimeState: () => state,
      getTimers: () => timers,
      isShuttingDown: () => false,
      onResume: () => {
        state = "running";
      },
      onUnhandledError,
    });

    controller.beginPauseEpisode();

    let firstChecks = 0;
    controller.recoverWhen({
      id: "db",
      everyMs: 10,
      check: async () => {
        firstChecks += 1;
        return false;
      },
    });

    await Promise.resolve();
    expect(firstChecks).toBe(1);

    const replacementChecks = jest.fn(async (): Promise<boolean> => {
      throw new Error("boom");
    });

    controller.recoverWhen({
      id: "db",
      everyMs: 10,
      check: replacementChecks,
    });

    await Promise.resolve();
    expect(firstChecks).toBe(1);
    expect(replacementChecks).toHaveBeenCalledTimes(1);
    expect(onUnhandledError).toHaveBeenCalledTimes(1);
  });

  it("skips evaluations after shutdown or explicit disposal", async () => {
    jest.useFakeTimers();

    let state: RuntimeState = "paused";
    let shuttingDown = true;
    let checks = 0;

    const timers = new RuntimeTimers(async () => undefined);
    const controller = new RuntimeRecoveryController({
      getRuntimeState: () => state,
      getTimers: () => timers,
      isShuttingDown: () => shuttingDown,
      onResume: () => {
        state = "running";
      },
      onUnhandledError: async () => undefined,
    });

    controller.beginPauseEpisode();
    controller.recoverWhen({
      everyMs: 10,
      check: async () => {
        checks += 1;
        return true;
      },
    });

    await Promise.resolve();
    expect(checks).toBe(0);

    shuttingDown = false;
    controller.dispose();
    await jest.advanceTimersByTimeAsync(20);
    expect(checks).toBe(0);
  });

  it("does not auto-resume when a pending check resolves after manual resume", async () => {
    let state: RuntimeState = "paused";
    let resolveCheck!: (value: boolean) => void;
    let resumes = 0;

    const timers = new RuntimeTimers(async () => undefined);
    const controller = new RuntimeRecoveryController({
      getRuntimeState: () => state,
      getTimers: () => timers,
      isShuttingDown: () => false,
      onResume: () => {
        resumes += 1;
        state = "running";
      },
      onUnhandledError: async () => undefined,
    });

    controller.beginPauseEpisode();
    controller.recoverWhen({
      everyMs: 10,
      check: () =>
        new Promise<boolean>((resolve) => {
          resolveCheck = resolve;
        }),
    });

    controller.resumeCurrentEpisode();
    resolveCheck(true);
    await Promise.resolve();

    expect(resumes).toBe(1);
  });

  it("does not auto-resume when a pending check resolves after cancellation", async () => {
    let state: RuntimeState = "paused";
    let resolveCheck!: (value: boolean) => void;
    let resumes = 0;

    const timers = new RuntimeTimers(async () => undefined);
    const controller = new RuntimeRecoveryController({
      getRuntimeState: () => state,
      getTimers: () => timers,
      isShuttingDown: () => false,
      onResume: () => {
        resumes += 1;
        state = "running";
      },
      onUnhandledError: async () => undefined,
    });

    controller.beginPauseEpisode();
    const handle = controller.recoverWhen({
      everyMs: 10,
      check: () =>
        new Promise<boolean>((resolve) => {
          resolveCheck = resolve;
        }),
    });

    handle.cancel();
    resolveCheck(true);
    await Promise.resolve();

    expect(resumes).toBe(0);
    expect(state).toBe("paused");
  });
});
