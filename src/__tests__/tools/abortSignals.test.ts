import { cancellationError } from "../../errors";
import {
  createCancellationErrorFromSignal,
  linkAbortSignals,
  raceWithAbortSignal,
} from "../../tools/abortSignals";

describe("abortSignals", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses the fallback reason when the signal has no explicit abort reason", () => {
    const error = createCancellationErrorFromSignal(
      {
        aborted: true,
        reason: undefined,
      } as AbortSignal,
      "fallback reason",
    );

    expect(cancellationError.is(error)).toBe(true);
    expect(error.message).toContain("fallback reason");
  });

  it("creates cancellation errors through the runner error helper", () => {
    const controller = new AbortController();
    controller.abort("boom");

    const error = createCancellationErrorFromSignal(controller.signal);

    expect(cancellationError.is(error)).toBe(true);
    expect(error.message).toContain("boom");
  });

  it("links multiple signals and detaches listeners after cleanup", () => {
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    const addEventListenerSpy = jest.spyOn(
      controllerA.signal,
      "addEventListener",
    );
    const removeEventListenerSpy = jest.spyOn(
      controllerA.signal,
      "removeEventListener",
    );

    const link = linkAbortSignals([controllerA.signal, controllerB.signal]);

    expect(link.signal).not.toBe(controllerA.signal);
    expect(link.signal).not.toBe(controllerB.signal);
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
      { once: true },
    );

    controllerA.abort("linked abort");

    if (!link.signal) {
      fail("Expected linked abort signal to exist");
    }

    expect(link.signal.aborted).toBe(true);
    expect(link.signal.reason).toBe("linked abort");

    link.cleanup();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
    );
  });

  it("returns an empty link when there are no sources", () => {
    const link = linkAbortSignals([]);

    expect(link.signal).toBeUndefined();
  });

  it("rejects immediately when raceWithAbortSignal receives an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort("already done");

    try {
      await raceWithAbortSignal(Promise.resolve("ok"), controller.signal);
      fail("Expected raceWithAbortSignal() to reject");
    } catch (error) {
      expect(cancellationError.is(error)).toBe(true);
      expect((error as Error).message).toContain("already done");
    }
  });
});
