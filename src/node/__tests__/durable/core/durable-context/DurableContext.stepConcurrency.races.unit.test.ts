import {
  createExecutionLockState,
  markExecutionLockLost,
} from "../../../../durable/core/managers/ExecutionManager.locking";
import { SuspensionSignal } from "../../../../durable/core/interfaces/context";
import { gate, stepFixture } from "./stepConcurrency.helpers";

describe("durable: step concurrency ownership and replay races", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("retains a still-owned step permit when execution ownership is lost before callback settlement", async () => {
    const lockState = createExecutionLockState();
    const first = await stepFixture({
      contextOptions: { executionLockState: lockState },
    });
    const second = await stepFixture({
      store: first.store,
      executionId: "contender",
    });
    const entered = gate();
    const finish = gate();
    let callbackSignal: AbortSignal | undefined;
    const failure = first.ctx
      .step("charge", { concurrency: 1 }, async ({ signal }) => {
        callbackSignal = signal;
        entered.open();
        await finish.promise;
        return 42;
      })
      .catch((error: unknown) => error);
    await entered.promise;
    markExecutionLockLost(lockState, "execution:execution");
    expect(await failure).toBe(lockState.lossError);
    expect(callbackSignal?.aborted).toBe(true);
    try {
      await expect(
        second.ctx.step("charge", { concurrency: 1 }, async () => 1),
      ).rejects.toBeInstanceOf(SuspensionSignal);
    } finally {
      finish.open();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await expect(
      second.replay().step("charge", { concurrency: 1 }, async () => 1),
    ).resolves.toBe(1);
    expect(await first.store.getStepResult("execution", "charge")).toBeNull();
  });

  it.each([true, false])(
    "discards an obsolete rate-window response (granted: %s)",
    async (granted) => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-01-01T00:00:00.250Z"));
      const first = await stepFixture();
      const second = await stepFixture({
        store: first.store,
        executionId: "current-window",
      });
      const entered = gate();
      let respond!: () => void;
      const acquire = first.store.acquireLock.bind(first.store);
      jest
        .spyOn(first.store, "acquireLock")
        .mockImplementationOnce(async (resource, ttl) => {
          const lockId = granted ? await acquire(resource, ttl) : null;
          return await new Promise<string | null>((resolve) => {
            respond = () => resolve(lockId);
            entered.open();
          });
        });
      const concurrency = { key: "provider", windowMs: 1000, max: 1 };
      const body = jest.fn(async () => 42);
      const failure = first.ctx
        .step("charge", { concurrency }, body)
        .catch((error: unknown) => error);
      await entered.promise;
      await jest.advanceTimersByTimeAsync(750);
      await second.ctx.step("charge", { concurrency }, async () => 1);
      respond();
      expect(await failure).toBeInstanceOf(SuspensionSignal);
      expect(body).not.toHaveBeenCalled();
      const timers = await first.store.getReadyTimers(
        new Date("2026-01-01T00:00:01.001Z"),
      );
      expect(timers).toEqual([
        expect.objectContaining({
          fireAt: new Date("2026-01-01T00:00:01.001Z"),
        }),
      ]);
      await expect(
        first.replay().step("charge", { concurrency }, body),
      ).rejects.toBeInstanceOf(SuspensionSignal);
      expect(body).not.toHaveBeenCalled();
    },
  );

  it("keeps the original window deadline when a denied acquisition is slow", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.250Z"));
    const { ctx, store } = await stepFixture();
    jest.spyOn(store, "acquireLock").mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      return null;
    });
    const failure = ctx
      .step(
        "charge",
        { concurrency: { windowMs: 1000, max: 1 } },
        async () => 1,
      )
      .catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(100);
    expect(await failure).toBeInstanceOf(SuspensionSignal);
    expect(
      await store.getReadyTimers(new Date("2026-01-01T00:00:01.000Z")),
    ).toEqual([
      expect.objectContaining({ fireAt: new Date("2026-01-01T00:00:01.000Z") }),
    ]);
  });

  it("preserves the callback retry budget across concurrency suspension and replay", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.250Z"));
    const { ctx, replay } = await stepFixture();
    const options = { concurrency: { windowMs: 1000, max: 1 }, retries: 1 };
    const body = jest.fn(async () => {
      throw new Error("provider failed");
    });
    const parked = ctx
      .step("charge", options, body)
      .catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(200);
    expect(await parked).toBeInstanceOf(SuspensionSignal);
    await jest.advanceTimersByTimeAsync(550);
    const exhausted = replay()
      .step("charge", options, body)
      .catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(200);
    expect(await exhausted).toMatchObject({ message: "provider failed" });
    expect(body).toHaveBeenCalledTimes(2);
  });
});
