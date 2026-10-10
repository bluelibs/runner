import { cancellationError } from "../../../../../errors";
import { createExecutionLockState } from "../../../../durable/core/managers/ExecutionManager.locking";
import { EXECUTION_PAUSED_ABORT_REASON } from "../../../../durable/core/pauseInterruption";
import { gate, stepFixture } from "./stepConcurrency.helpers";

describe("durable: step concurrency lifecycle", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each(["timeout", "cancel"])(
    "signals %s but retains the permit until an uncooperative callback settles",
    async (reason) => {
      jest.useFakeTimers();
      const caller = new AbortController();
      const first = await stepFixture({
        contextOptions: { cancellationSignal: caller.signal },
      });
      const second = await stepFixture({
        store: first.store,
        executionId: "second",
      });
      const entered = gate();
      const finish = gate();
      let bodySignal: AbortSignal | undefined;
      const failure = first.ctx
        .step(
          "charge",
          { concurrency: 1, timeout: reason === "timeout" ? 20 : undefined },
          async ({ signal }) => {
            bodySignal = signal;
            entered.open();
            await finish.promise;
            return 42;
          },
        )
        .catch((error: unknown) => error);
      await entered.promise;
      if (reason === "timeout") await jest.advanceTimersByTimeAsync(20);
      else caller.abort(new Error("cancelled"));
      expect(await failure).toBeInstanceOf(Error);
      expect(bodySignal?.aborted).toBe(true);
      expect(await first.store.getStepResult("execution", "charge")).toBeNull();
      await expect(
        second.ctx.step("charge", { concurrency: 1 }, async () => 1),
      ).rejects.toThrow("step-concurrency");
      finish.open();
      await jest.advanceTimersByTimeAsync(0);
      await expect(
        second.replay().step("charge", { concurrency: 1 }, async () => 1),
      ).resolves.toBe(1);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it("releases a cooperative callback after cancellation", async () => {
    const caller = new AbortController();
    const { ctx, store } = await stepFixture({
      contextOptions: { cancellationSignal: caller.signal },
    });
    const release = jest.spyOn(store, "releaseLock");
    const entered = gate();
    const failure = ctx
      .step("charge", { concurrency: 1 }, async ({ signal }) => {
        entered.open();
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        signal.throwIfAborted();
      })
      .catch((error: unknown) => error);
    await entered.promise;
    caller.abort(new Error("cancelled"));
    expect(await failure).toBeInstanceOf(Error);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rejects pre-cancelled calls before contacting store locks", async () => {
    const caller = new AbortController();
    caller.abort(new Error("cancelled"));
    const { ctx, store } = await stepFixture({
      contextOptions: { cancellationSignal: caller.signal },
    });
    const acquire = jest.spyOn(store, "acquireLock");
    const body = jest.fn(async () => 42);
    await expect(ctx.step("charge", { concurrency: 1 }, body)).rejects.toThrow(
      "cancelled",
    );
    expect(acquire).not.toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
  });

  it("cancels stalled acquisition and reclaims a late grant without starting user code", async () => {
    const caller = new AbortController();
    const { ctx, store } = await stepFixture({
      contextOptions: { cancellationSignal: caller.signal },
    });
    const entered = gate();
    const originalAcquire = store.acquireLock.bind(store);
    let grant!: (value: string | null) => void;
    let resource = "";
    jest.spyOn(store, "acquireLock").mockImplementationOnce((key) => {
      resource = key;
      entered.open();
      return new Promise((resolve) => {
        grant = resolve;
      });
    });
    const release = jest.spyOn(store, "releaseLock");
    const body = jest.fn(async () => 42);
    const failure = ctx
      .step("charge", { concurrency: 1 }, body)
      .catch((error: unknown) => error);
    await entered.promise;
    caller.abort(new Error("cancelled"));
    expect(cancellationError.is(await failure, { reason: "cancelled" })).toBe(
      true,
    );
    const lockId = await originalAcquire(resource, 30000);
    grant(lockId);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(release).toHaveBeenCalledWith(resource, lockId);
    expect(body).not.toHaveBeenCalled();
  });

  it("renews long callbacks, aborts on lease loss, and prevents step-result persistence", async () => {
    jest.useFakeTimers();
    const lockState = createExecutionLockState();
    const { ctx, store } = await stepFixture({
      contextOptions: { executionLockState: lockState },
    });
    const renew = jest.spyOn(store, "renewLock");
    const entered = gate();
    const finish = gate();
    let bodySignal: AbortSignal | undefined;
    const failure = ctx
      .step("charge", { concurrency: 1, retries: 3 }, async ({ signal }) => {
        bodySignal = signal;
        entered.open();
        await finish.promise;
        return 42;
      })
      .catch((error: unknown) => error);
    await entered.promise;
    await jest.advanceTimersByTimeAsync(10000);
    expect(renew).toHaveBeenCalledTimes(1);
    renew.mockResolvedValueOnce(false);
    await jest.advanceTimersByTimeAsync(10000);
    expect(await failure).toMatchObject({
      message: expect.stringContaining("lock lost"),
    });
    expect(lockState.lost).toBe(true);
    expect(bodySignal?.aborted).toBe(true);
    finish.open();
    await jest.advanceTimersByTimeAsync(0);
    expect(await store.getStepResult("execution", "charge")).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("verifies lease ownership immediately before saving a completed step", async () => {
    const { ctx, store } = await stepFixture();
    jest.spyOn(store, "renewLock").mockResolvedValue(false);
    const save = jest.spyOn(store, "saveStepResult");
    const body = jest.fn(async () => 42);
    await expect(
      ctx.step("charge", { concurrency: 1, retries: 3 }, body),
    ).rejects.toThrow("lock lost");
    expect(body).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it("refuses a grant whose acquisition response outlives its lease", async () => {
    jest.useFakeTimers();
    const { ctx, store } = await stepFixture();
    jest
      .spyOn(store, "acquireLock")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => setTimeout(() => resolve("expired"), 31000)),
      );
    const release = jest.spyOn(store, "releaseLock");
    const body = jest.fn(async () => 42);
    const failure = ctx
      .step("charge", { concurrency: 1 }, body)
      .catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(31000);
    expect(await failure).toMatchObject({
      message: expect.stringContaining("lock lost"),
    });
    expect(body).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("allows a paused execution to retain a finished step result", async () => {
    const { ctx, store } = await stepFixture();
    await expect(
      ctx.step("charge", { concurrency: 1 }, async () => {
        await store.updateExecution("execution", { status: "paused" });
        return 42;
      }),
    ).resolves.toBe(42);
    expect((await store.getStepResult("execution", "charge"))?.result).toBe(42);
  });

  it("stops an admitted callback when the attempt is paused", async () => {
    const caller = new AbortController();
    const { ctx } = await stepFixture({
      contextOptions: { cancellationSignal: caller.signal },
    });
    const entered = gate();
    const finish = gate();
    const failure = ctx
      .step("charge", { concurrency: 1 }, async () => {
        entered.open();
        await finish.promise;
      })
      .catch((error: unknown) => error);
    await entered.promise;
    caller.abort(EXECUTION_PAUSED_ABORT_REASON);
    expect(await failure).toBeInstanceOf(Error);
    finish.open();
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  it("keeps a fixed-window grant consumed when it arrives after cancellation", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.250Z"));
    const caller = new AbortController();
    const first = await stepFixture({
      contextOptions: { cancellationSignal: caller.signal },
    });
    const second = await stepFixture({
      store: first.store,
      executionId: "late-rate",
    });
    const entered = gate();
    let deliver!: () => void;
    const acquire = first.store.acquireLock.bind(first.store);
    jest
      .spyOn(first.store, "acquireLock")
      .mockImplementationOnce(async (resource, ttl) => {
        const lockId = await acquire(resource, ttl);
        return await new Promise<string | null>((resolve) => {
          deliver = () => resolve(lockId);
          entered.open();
        });
      });
    const release = jest.spyOn(first.store, "releaseLock");
    const concurrency = { key: "late-provider", windowMs: 60000, max: 1 };
    const body = jest.fn(async () => 42);
    const failure = first.ctx
      .step("charge", { concurrency }, body)
      .catch((error: unknown) => error);
    await entered.promise;
    caller.abort(new Error("cancelled"));
    expect(cancellationError.is(await failure, { reason: "cancelled" })).toBe(
      true,
    );
    deliver();
    await jest.advanceTimersByTimeAsync(0);
    expect(release).not.toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
    await expect(
      second.ctx.step("charge", { concurrency }, body),
    ).rejects.toThrow("step-concurrency");
  });
});
