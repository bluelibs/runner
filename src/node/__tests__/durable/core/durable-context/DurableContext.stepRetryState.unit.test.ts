import { stepFixture } from "./stepConcurrency.helpers";

describe("durable: concurrency retry journals", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("gives a new workflow attempt its own callback retry budget", async () => {
    const first = await stepFixture();
    const options = { concurrency: 1, retries: 1 };
    const failing = jest.fn(async () => {
      throw new Error("failed");
    });
    const failure = first.ctx
      .step("charge", options, failing)
      .catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(200);
    expect(await failure).toMatchObject({ message: "failed" });
    const second = await stepFixture({ store: first.store, attempt: 2 });
    const body = jest
      .fn()
      .mockRejectedValueOnce(new Error("retry"))
      .mockResolvedValueOnce(42);
    const pending = second.ctx.step("charge", options, body);
    await jest.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toBe(42);
    expect(body).toHaveBeenCalledTimes(2);
    expect(
      (await first.store.getStepResult("execution", '__step-retries:"charge"'))
        ?.result,
    ).toEqual({ workflowAttempt: 2, count: 1 });
  });

  it("fails before acquiring capacity when persisted retry state is malformed", async () => {
    const { ctx, store } = await stepFixture();
    await store.saveStepResult({
      executionId: "execution",
      stepId: '__step-retries:"charge"',
      result: { workflowAttempt: 1, count: "bad" },
      completedAt: new Date(),
    });
    const acquire = jest.spyOn(store, "acquireLock");
    const body = jest.fn(async () => 42);
    await expect(
      ctx.step("charge", { concurrency: 1, retries: 1 }, body),
    ).rejects.toThrow();
    expect(acquire).not.toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
  });

  it("does not retry when retry consumption cannot be persisted", async () => {
    const { ctx, store } = await stepFixture();
    jest
      .spyOn(store, "saveStepResult")
      .mockRejectedValueOnce(new Error("disk down"));
    const release = jest.spyOn(store, "releaseLock");
    const body = jest.fn(async () => {
      throw new Error("provider failed");
    });
    const failure = ctx
      .step("charge", { concurrency: 1, retries: 1 }, body)
      .catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(0);
    expect(await failure).toMatchObject({ message: "disk down" });
    expect(body).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
