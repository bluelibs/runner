import { gate, stepFixture } from "./stepConcurrency.helpers";

it("bounds ignored cancellation by lease expiry and protects the replacement owner's token", async () => {
  jest.useFakeTimers();
  try {
    const caller = new AbortController();
    const first = await stepFixture({
      contextOptions: { cancellationSignal: caller.signal },
    });
    const second = await stepFixture({
      store: first.store,
      executionId: "replacement",
    });
    const third = await stepFixture({
      store: first.store,
      executionId: "contender",
    });
    const oldEntered = gate();
    const oldFinish = gate();
    const failure = first.ctx
      .step("charge", { concurrency: 1 }, async () => {
        oldEntered.open();
        await oldFinish.promise;
      })
      .catch((error: unknown) => error);
    await oldEntered.promise;
    caller.abort(new Error("cancelled"));
    expect(await failure).toBeInstanceOf(Error);
    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(0);
    await expect(
      second.ctx.step("charge", { concurrency: 1 }, async () => 42),
    ).rejects.toThrow("step-concurrency");
    await jest.advanceTimersByTimeAsync(30000);
    const newEntered = gate();
    const newFinish = gate();
    const held = second
      .replay()
      .step("charge", { concurrency: 1 }, async () => {
        newEntered.open();
        await newFinish.promise;
        return 42;
      });
    await newEntered.promise;
    try {
      oldFinish.open();
      await jest.advanceTimersByTimeAsync(0);
      await expect(
        third.ctx.step("charge", { concurrency: 1 }, async () => 1),
      ).rejects.toThrow("step-concurrency");
    } finally {
      newFinish.open();
      await held;
    }
    expect(jest.getTimerCount()).toBe(0);
    expect(await first.store.getStepResult("execution", "charge")).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});
