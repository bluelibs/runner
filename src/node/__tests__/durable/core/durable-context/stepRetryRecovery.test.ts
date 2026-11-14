import { stepFixture, gate } from "./stepConcurrency.helpers";
import { saveStepRetryCount } from "../../../../durable/core/durable-context/DurableContext.stepRetryState";

describe("step retry recovery", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("retains the unelapsed part of a saved backoff before calling the next callback", async () => {
    const { ctx, store } = await stepFixture();
    await saveStepRetryCount({
      store,
      executionId: "execution",
      stepId: "work",
      workflowAttempt: 1,
      count: 2,
      nextAttemptAtMs: Date.now() + 1000,
    });
    const body = jest.fn(async (step) => step.attempt);
    const result = ctx.step("work", { retries: 3 }, body);
    await jest.advanceTimersByTimeAsync(999);
    expect(body).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(await result).toBe(3);
  });

  it("reads legacy retry records without a deadline and resets counts for a new workflow attempt", async () => {
    const first = await stepFixture();
    await saveStepRetryCount({
      store: first.store,
      executionId: "execution",
      stepId: "legacy",
      workflowAttempt: 1,
      count: 2,
    });
    expect(
      await first.ctx.step(
        "legacy",
        { retries: 2 },
        async (step) => step.attempt,
      ),
    ).toBe(3);
    await saveStepRetryCount({
      store: first.store,
      executionId: "execution",
      stepId: "old",
      workflowAttempt: 1,
      count: 2,
      nextAttemptAtMs: Date.now() + 10000,
    });
    const next = await stepFixture({ store: first.store, attempt: 2 });
    expect(
      await next.ctx.step("old", { retries: 1 }, async (step) => step.attempt),
    ).toBe(1);
  });

  it("allows a failed heartbeat to be retried and closes the deadline before a late save settles", async () => {
    const { ctx, store } = await stepFixture();
    const persist = store.saveStepResult.bind(store);
    const entered = gate();
    const release = gate();
    let saves = 0;
    jest.spyOn(store, "saveStepResult").mockImplementation(async (record) => {
      if (record.stepId.startsWith("__step-progress:")) {
        saves++;
        if (saves === 1) throw new Error("transient storage error");
        entered.open();
        await release.promise;
      }
      await persist(record);
    });
    let heartbeat!: Promise<void>;
    const result = ctx.step(
      "import",
      { heartbeatTimeoutMs: 100 },
      async (step) => {
        await expect(step.heartbeat({ cursor: 1 })).rejects.toThrow(
          "transient storage error",
        );
        heartbeat = step.heartbeat({ cursor: 2 });
        await entered.promise;
        return "done";
      },
    );
    expect(await result).toBe("done");
    release.open();
    await heartbeat;
    await jest.advanceTimersByTimeAsync(1000);
    expect(
      (await store.getStepResult("execution", '__step-progress:"import"'))
        ?.result,
    ).toEqual({ cursor: 2 });
  });
});
