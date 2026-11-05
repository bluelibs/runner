import { runAdmittedStepCallback } from "../../../../durable/core/durable-context/DurableContext.stepCallback";
import {
  createExecutionLockState,
  markExecutionLockLost,
} from "../../../../durable/core/managers/ExecutionManager.locking";
import { gate } from "./stepConcurrency.helpers";

function fixture(signal: AbortSignal) {
  return {
    stepId: "charge",
    options: {},
    signal,
    lockState: createExecutionLockState(),
    upFn: jest.fn(async () => 42),
    deferRelease: jest.fn(),
    release: jest.fn(async () => {}),
  };
}

describe("durable: admitted callback handoff", () => {
  it("does not start already cancelled work", async () => {
    const caller = new AbortController();
    caller.abort(new Error("cancelled"));
    const value = fixture(caller.signal);
    await expect(runAdmittedStepCallback(value)).rejects.toThrow("cancelled");
    expect(value.upFn).not.toHaveBeenCalled();
    expect(value.deferRelease).not.toHaveBeenCalled();
  });

  it("does not enter user code when cancellation races the callback microtask", async () => {
    const caller = new AbortController();
    const value = fixture(caller.signal);
    const failure = runAdmittedStepCallback(value).catch(
      (error: unknown) => error,
    );
    caller.abort(new Error("cancelled"));
    expect(await failure).toBeInstanceOf(Error);
    expect(value.upFn).not.toHaveBeenCalled();
  });

  it("does not enter user code after losing attempt ownership during handoff", async () => {
    const value = fixture(new AbortController().signal);
    const failure = runAdmittedStepCallback(value).catch(
      (error: unknown) => error,
    );
    markExecutionLockLost(value.lockState, "execution");
    expect(await failure).toMatchObject({
      message: expect.stringContaining("lock lost"),
    });
    expect(value.upFn).not.toHaveBeenCalled();
  });

  it("keeps deferred cleanup failures from becoming unhandled rejections", async () => {
    const caller = new AbortController();
    const value = fixture(caller.signal);
    const entered = gate();
    const finish = gate();
    value.upFn.mockImplementationOnce(async () => {
      entered.open();
      await finish.promise;
      return 42;
    });
    value.release.mockRejectedValueOnce(new Error("cleanup failed"));
    const failure = runAdmittedStepCallback(value).catch(
      (error: unknown) => error,
    );
    await entered.promise;
    caller.abort(new Error("cancelled"));
    expect(await failure).toBeInstanceOf(Error);
    finish.open();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(value.release).toHaveBeenCalledTimes(1);
  });
});
