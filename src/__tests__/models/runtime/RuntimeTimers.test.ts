import { defineResource } from "../../../define";
import { globalResources } from "../../../globals/globalResources";
import { RuntimeTimers } from "../../../models/runtime/RuntimeTimers";
import { run } from "../../../run";

describe("RuntimeTimers", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("allows timers during bootstrap through runner.timers", async () => {
    const probe = defineResource({
      id: "runner-timers-bootstrap-probe",
      dependencies: { timers: globalResources.timers },
      async init(_config, { timers }) {
        const calls: string[] = [];
        timers.setTimeout(() => {
          calls.push("timeout");
        }, 0);
        await Promise.resolve();
        jest.runOnlyPendingTimers();
        expect(calls).toEqual(["timeout"]);
        return "ok";
      },
    });

    const app = defineResource({
      id: "runner-timers-bootstrap-app",
      register: [probe],
      dependencies: { probe },
      async init() {
        return "ready";
      },
    });

    jest.useFakeTimers();
    try {
      const runtime = await run(app, { shutdownHooks: false });
      await runtime.dispose();
    } finally {
      jest.useRealTimers();
    }
  });

  it("runs resource timers once and cancels intervals on disposal without overlap", async () => {
    jest.useFakeTimers();

    const app = defineResource({
      id: "runtime-timers-app",
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, { shutdownHooks: false });
    const timers = runtime.getResourceValue(globalResources.timers);
    const timeoutCalls: number[] = [];
    const intervalCalls: number[] = [];
    let releaseIntervalTick: (() => void) | undefined;

    timers.setTimeout(() => {
      timeoutCalls.push(1);
    }, 20);

    timers.setInterval(async () => {
      intervalCalls.push(intervalCalls.length + 1);
      await new Promise<void>((resolve) => {
        releaseIntervalTick = resolve;
      });
    }, 10);

    await jest.advanceTimersByTimeAsync(10);
    expect(intervalCalls).toEqual([1]);

    await jest.advanceTimersByTimeAsync(30);
    expect(intervalCalls).toEqual([1]);
    expect(timeoutCalls).toEqual([1]);

    await runtime.dispose();
    releaseIntervalTick?.();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(100);
    expect(intervalCalls).toEqual([1]);
    expect(timeoutCalls).toEqual([1]);
  });

  it("supports cooldown, idempotent cancellation, direct disposal, and error reporting", async () => {
    jest.useFakeTimers();

    const onUnhandledError = jest.fn();
    const timers = new RuntimeTimers(onUnhandledError);
    const timeoutCallback = jest.fn();
    const intervalCallback = jest
      .fn()
      .mockRejectedValueOnce(new Error("timer failure"));

    const timeoutHandle = timers.setTimeout(timeoutCallback, 10);
    timeoutHandle.cancel();
    timeoutHandle.cancel();

    const intervalHandle = timers.setInterval(intervalCallback, 10);

    await jest.advanceTimersByTimeAsync(10);
    expect(intervalCallback).toHaveBeenCalledTimes(1);
    expect(onUnhandledError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "run",
        source: "runner.timers.setInterval",
      }),
    );

    intervalHandle.cancel();
    intervalHandle.cancel();
    timers.cooldown();
    expect(() => timers.setTimeout(() => undefined, 1)).toThrow(
      "Runner timers are no longer accepting new timers because cooldown or disposal has started.",
    );
    timers.dispose();
    timers.dispose();

    await jest.advanceTimersByTimeAsync(50);
    expect(timeoutCallback).not.toHaveBeenCalled();
  });
});
