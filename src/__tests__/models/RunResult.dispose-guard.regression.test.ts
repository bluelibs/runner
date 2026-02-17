import { defineEvent, defineResource, defineTask } from "../../define";
import { run } from "../../run";
import { createMessageError } from "../../errors";

describe("RunResult disposal guards", () => {
  it("throws clear errors when accessed after dispose and allows idempotent double-dispose", async () => {
    const sampleTask = defineTask({
      id: "runresult.dispose.guard.task",
      async run() {
        return "ok";
      },
    });

    const sampleEvent = defineEvent({
      id: "runresult.dispose.guard.event",
    });

    const app = defineResource({
      id: "runresult.dispose.guard.app",
      register: [sampleTask, sampleEvent],
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, { shutdownHooks: false });

    await runtime.dispose();

    expect(() => runtime.runTask(sampleTask)).toThrow(/disposed/i);
    expect(() => runtime.emitEvent(sampleEvent, undefined)).toThrow(
      /disposed/i,
    );
    expect(() => runtime.getResourceValue(app)).toThrow(/disposed/i);
    expect(() => runtime.getResourceConfig(app)).toThrow(/disposed/i);

    await expect(runtime.dispose()).resolves.toBeUndefined();
  });

  it("returns the same pending promise for concurrent dispose calls", async () => {
    let releaseDispose: (() => void) | undefined;
    const waitForDispose = new Promise<void>((resolve) => {
      releaseDispose = resolve;
    });
    let disposeCalls = 0;

    const app = defineResource({
      id: "runresult.dispose.guard.concurrent.app",
      async init() {
        return "ready";
      },
      async dispose() {
        disposeCalls += 1;
        await waitForDispose;
      },
    });

    const runtime = await run(app, { shutdownHooks: false });

    const firstDispose = runtime.dispose();
    const secondDispose = runtime.dispose();

    expect(secondDispose).toBe(firstDispose);

    if (!releaseDispose) {
      throw createMessageError("Dispose release handler was not initialized");
    }
    releaseDispose();

    await expect(firstDispose).resolves.toBeUndefined();
    await expect(secondDispose).resolves.toBeUndefined();
    expect(disposeCalls).toBe(1);
  });

  it("allows retrying dispose when cleanup previously failed", async () => {
    const app = defineResource({
      id: "runresult.dispose.retry.app",
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, { shutdownHooks: false });

    let disposeAttempts = 0;
    const disposeSpy = jest
      .spyOn(runtime.store, "dispose")
      .mockImplementation(async () => {
        disposeAttempts += 1;
        if (disposeAttempts === 1) {
          throw createMessageError("first dispose failure");
        }
      });

    await expect(runtime.dispose()).rejects.toThrow("first dispose failure");
    await expect(runtime.dispose()).resolves.toBeUndefined();
    expect(disposeSpy).toHaveBeenCalledTimes(2);
  });
});
