import { abortableDelay } from "../../globals/middleware/retry.middleware";

/** Backend-independent ownership controls for an already-acquired renewable lease. */
export interface RenewableLease {
  /** Rejects when renewal, expiry, or the owner invalidates the lease. */
  lost: Promise<never>;
  /** Refuses to begin work after the conservative local deadline. */
  assertActive(): void;
  /** Verifies backend ownership before committing the callback's result. */
  assertOwnership(): Promise<void>;
  /** Invalidates ownership and signals the owning runtime. */
  fail(error: Error): void;
  /** Stops renewal while leaving the backend token to settle or expire. */
  stopRenewal(): void;
  /** Stops renewal and releases the backend token without waiting for renewal responses. */
  release(): Promise<void>;
}

/** Shared renewal and deadline handling for resilience and durable admission. */
export function createRenewableLease(options: {
  leaseMs: number;
  leaseDeadline: number;
  renew: () => Promise<boolean>;
  release: () => Promise<unknown>;
  onLoss: (error: Error) => void;
  errors: {
    lost: () => Error;
    beforeExecution: () => Error;
    beforeCompletion: () => Error;
    renewal: (error: unknown) => Error;
  };
}): RenewableLease {
  const heartbeat = new AbortController();
  let leaseDeadline = options.leaseDeadline;
  let failure: Error | undefined;
  let rejectLoss!: (error: Error) => void;
  const lost = new Promise<never>((_resolve, reject) => {
    rejectLoss = reject;
  });
  void lost.catch(() => {});

  let deadline: ReturnType<typeof setTimeout> | undefined;
  const stopRenewal = () => {
    heartbeat.abort();
    clearTimeout(deadline);
  };
  const fail = (error: Error) => {
    if (failure || heartbeat.signal.aborted) return;
    failure = error;
    stopRenewal();
    options.onLoss(error);
    rejectLoss(error);
  };
  const remaining = () => Math.max(0, leaseDeadline - performance.now());
  const expire = () => fail(options.errors.lost());
  deadline = setTimeout(expire, remaining());
  deadline.unref?.();
  void (async () => {
    try {
      while (!heartbeat.signal.aborted) {
        await abortableDelay(
          Math.max(1, Math.floor(options.leaseMs / 3)),
          heartbeat.signal,
        );
        const requestedAt = performance.now();
        const renewed = await options.renew();
        if (heartbeat.signal.aborted) return;
        if (!renewed || performance.now() - requestedAt >= options.leaseMs) {
          expire();
          return;
        }
        leaseDeadline = requestedAt + options.leaseMs;
        clearTimeout(deadline);
        deadline = setTimeout(expire, remaining());
        deadline.unref?.();
      }
    } catch (error) {
      if (!heartbeat.signal.aborted) fail(options.errors.renewal(error));
    }
  })();

  return {
    lost,
    fail,
    stopRenewal,
    assertActive() {
      if (failure) throw failure;
      if (remaining() === 0) {
        const error = options.errors.beforeExecution();
        fail(error);
        throw error;
      }
    },
    async assertOwnership() {
      if (failure) throw failure;
      if (heartbeat.signal.aborted) return;
      try {
        const requestedAt = performance.now();
        if (
          !(await options.renew()) ||
          performance.now() - requestedAt >= options.leaseMs
        ) {
          throw options.errors.beforeCompletion();
        }
        if (failure) throw failure;
      } catch (error) {
        const ownershipError = options.errors.renewal(error);
        fail(ownershipError);
        throw ownershipError;
      }
    },
    async release() {
      stopRenewal();
      // Renewal is token-fenced: a late request cannot resurrect a released lease.
      clearTimeout(deadline);
      await options.release();
    },
  };
}
