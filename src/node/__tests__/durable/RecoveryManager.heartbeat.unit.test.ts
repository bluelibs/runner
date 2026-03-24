import { RecoveryManager } from "../../durable/core/managers/RecoveryManager";
import { flushMicrotasks } from "./DurableService.unit.helpers";

describe("durable: RecoveryManager heartbeat (unit)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("returns a noop stop handler when recovery uses no-lock mode", () => {
    const manager = new RecoveryManager(
      {
        acquireLock: jest.fn(async () => "lock-1"),
        releaseLock: jest.fn(async () => {}),
      } as any,
      { recoverExecution: jest.fn(async () => {}) } as any,
      { error: jest.fn(async () => {}) } as any,
    );

    const stop = (manager as any).startClaimHeartbeat(
      "recovery:execution:e1",
      "no-lock",
      3_000,
    );

    expect(stop).toBeInstanceOf(Function);
    expect(() => stop()).not.toThrow();
  });

  it("does nothing when the store cannot renew recovery claims", () => {
    const manager = new RecoveryManager(
      {
        acquireLock: jest.fn(async () => "lock-3"),
        releaseLock: jest.fn(async () => {}),
      } as any,
      { recoverExecution: jest.fn(async () => {}) } as any,
      { error: jest.fn(async () => {}) } as any,
    );

    const stop = (manager as any).startClaimHeartbeat(
      "recovery:execution:e2",
      "lock-3",
      3_000,
    );

    expect(() => stop()).not.toThrow();
  });

  it("retries renewals and tolerates stopping while a renewal is still pending", async () => {
    jest.useFakeTimers();

    const renewLock = jest
      .fn(async () => false)
      .mockRejectedValueOnce(new Error("renew failed"));
    const renewingManager = new RecoveryManager(
      {
        acquireLock: jest.fn(async () => "lock-4"),
        releaseLock: jest.fn(async () => {}),
        renewLock,
      } as any,
      { recoverExecution: jest.fn(async () => {}) } as any,
      { error: jest.fn(async () => {}) } as any,
    );

    const stopRenewal = (renewingManager as any).startClaimHeartbeat(
      "recovery:execution:e3",
      "lock-4",
      3_000,
    );
    jest.advanceTimersByTime(1_000);
    await flushMicrotasks();
    expect(renewLock).toHaveBeenCalledTimes(1);
    stopRenewal();

    let resolvePendingRenewal!: (value: boolean) => void;
    const pendingRenewLock = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePendingRenewal = resolve;
        }),
    );
    const pendingRenewalManager = new RecoveryManager(
      {
        acquireLock: jest.fn(async () => "lock-6"),
        releaseLock: jest.fn(async () => {}),
        renewLock: pendingRenewLock,
      } as any,
      { recoverExecution: jest.fn(async () => {}) } as any,
      { error: jest.fn(async () => {}) } as any,
    );

    const stopPendingRenewal = (
      pendingRenewalManager as any
    ).startClaimHeartbeat("recovery:execution:e5", "lock-6", 3_000);
    jest.advanceTimersByTime(1_000);
    await flushMicrotasks();
    expect(pendingRenewLock).toHaveBeenCalledTimes(1);
    stopPendingRenewal();
    resolvePendingRenewal(false);
    await flushMicrotasks();
  });

  it("keeps retrying recovery-heartbeat renewals after a transient renew failure", async () => {
    jest.useFakeTimers();

    const renewLock = jest
      .fn(async () => true)
      .mockRejectedValueOnce(new Error("renew failed"))
      .mockResolvedValueOnce(true);
    const manager = new RecoveryManager(
      {
        acquireLock: jest.fn(async () => "lock-transient"),
        releaseLock: jest.fn(async () => {}),
        renewLock,
      } as any,
      { recoverExecution: jest.fn(async () => {}) } as any,
      { error: jest.fn(async () => {}) } as any,
    );

    const stop = (manager as any).startClaimHeartbeat(
      "recovery:execution:e-transient",
      "lock-transient",
      3_000,
    );

    jest.advanceTimersByTime(1_000);
    await flushMicrotasks();
    jest.advanceTimersByTime(1_000);
    await flushMicrotasks();

    expect(renewLock).toHaveBeenCalledTimes(2);
    stop();
  });

  it("clears scheduled heartbeats when stopped", () => {
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    const queuedCallbacks: Array<() => void> = [];
    const clearTimeoutSpy = jest.fn();

    (global as any).setTimeout = (callback: () => void) => {
      queuedCallbacks.push(callback);
      return { unref: () => {} };
    };
    (global as any).clearTimeout = clearTimeoutSpy;

    try {
      const manager = new RecoveryManager(
        {
          acquireLock: jest.fn(async () => "lock-5"),
          releaseLock: jest.fn(async () => {}),
          renewLock: jest.fn(async () => false),
        } as any,
        { recoverExecution: jest.fn(async () => {}) } as any,
        { error: jest.fn(async () => {}) } as any,
      );

      const stop = (manager as any).startClaimHeartbeat(
        "recovery:execution:e4",
        "lock-5",
        3_000,
      );
      stop();
      queuedCallbacks[0]?.();

      expect(clearTimeoutSpy).toHaveBeenCalled();
    } finally {
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }
  });
});
