import { BootstrapCoordinator } from "../../tools/BootstrapCoordinator";
import { createRunDisposalSignalController } from "../../tools/runDisposalSignal";
import type { RunResult } from "../../models/RunResult";

async function flushMicrotasks(iterations: number = 12): Promise<void> {
  for (let i = 0; i < iterations; i += 1) {
    await Promise.resolve();
  }
}

describe("runDisposalSignal", () => {
  function createRuntimeDouble(dispose = jest.fn()) {
    return {
      runtime: { dispose } as unknown as RunResult<unknown>,
      dispose,
    };
  }

  it("returns no-op hooks when no signal was provided", () => {
    const { runtime } = createRuntimeDouble();
    const controller = createRunDisposalSignalController({
      bootstrap: new BootstrapCoordinator(),
      runtime,
      onUnhandledError: jest.fn(),
    });

    expect(() => controller.assertNotAborted()).not.toThrow();
    expect(() => controller.cleanup()).not.toThrow();
  });

  it("skips runtime disposal when bootstrap cancellation finishes unsuccessfully", async () => {
    const abortController = new AbortController();
    const { runtime, dispose } = createRuntimeDouble();
    const bootstrap = new BootstrapCoordinator();

    createRunDisposalSignalController({
      signal: abortController.signal,
      bootstrap,
      runtime,
      onUnhandledError: jest.fn(),
    });

    abortController.abort("stop during bootstrap");
    bootstrap.markCompleted(false);
    await flushMicrotasks();

    expect(dispose).not.toHaveBeenCalled();
  });

  it("disposes the runtime after bootstrap eventually succeeds", async () => {
    const abortController = new AbortController();
    const { runtime, dispose } = createRuntimeDouble(
      jest.fn(async () => undefined),
    );
    const bootstrap = new BootstrapCoordinator();

    createRunDisposalSignalController({
      signal: abortController.signal,
      bootstrap,
      runtime,
      onUnhandledError: jest.fn(),
    });

    abortController.abort("finish shutdown");
    bootstrap.markCompleted(true);
    await flushMicrotasks();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("throws immediately when asked to continue with an already-aborted signal", () => {
    const abortController = new AbortController();
    abortController.abort("already gone");

    const controller = createRunDisposalSignalController({
      signal: abortController.signal,
      bootstrap: new BootstrapCoordinator(),
      runtime: createRuntimeDouble().runtime,
      onUnhandledError: jest.fn(),
    });

    expect(() => controller.assertNotAborted()).toThrow(/already gone/);
  });

  it("removes the abort listener during cleanup", () => {
    const abortController = new AbortController();
    const removeEventListenerSpy = jest.spyOn(
      abortController.signal,
      "removeEventListener",
    );
    const controller = createRunDisposalSignalController({
      signal: abortController.signal,
      bootstrap: new BootstrapCoordinator(),
      runtime: createRuntimeDouble().runtime,
      onUnhandledError: jest.fn(),
    });

    controller.cleanup();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
    );
  });
});
