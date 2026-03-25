import type { IDurableStore } from "../interfaces/store";
import { durableExecutionInvariantError } from "../../../../errors";

export type ExecutionLockState = {
  lost: boolean;
  lossError: Error | null;
  lockId: string | "no-lock" | undefined;
  lockResource: string | undefined;
  lockTtlMs: number | undefined;
  triggerLoss: (error: Error) => void;
  waitForLoss: Promise<never>;
};

export function createExecutionLockState(): ExecutionLockState {
  let didLoseLock = false;
  let rejectLoss: ((error: Error) => void) | null = null;
  const waitForLoss = new Promise<never>((_, reject) => {
    rejectLoss = reject;
  });
  void waitForLoss.catch(() => {});

  return {
    lost: false,
    lossError: null,
    lockId: undefined,
    lockResource: undefined,
    lockTtlMs: undefined,
    triggerLoss: (error) => {
      if (didLoseLock || rejectLoss === null) return;
      didLoseLock = true;
      rejectLoss(error);
    },
    waitForLoss,
  };
}

export function markExecutionLockLost(
  lockState: ExecutionLockState,
  lockResource: string,
): Error {
  if (lockState.lossError) {
    lockState.lost = true;
    return lockState.lossError;
  }

  const lossError = durableExecutionInvariantError.new({
    message: `Execution lock lost for '${lockResource}' while the attempt was still running.`,
  });
  lockState.lost = true;
  lockState.lossError = lossError;
  lockState.triggerLoss(lossError);
  return lossError;
}

export async function assertStoreLockOwnership(params: {
  store: IDurableStore;
  lockState: ExecutionLockState;
}): Promise<void> {
  const { store, lockState } = params;
  const { lockId, lockResource, lockTtlMs } = lockState;

  if (
    lockState.lost ||
    lockId === undefined ||
    lockResource === undefined ||
    lockTtlMs === undefined ||
    lockId === "no-lock" ||
    !store.renewLock
  ) {
    if (lockState.lost) {
      throw lockState.lossError;
    }
    return;
  }

  try {
    const renewed = await store.renewLock(lockResource, lockId, lockTtlMs);
    if (renewed) {
      return;
    }
  } catch {
    // Failing closed avoids persisting an outcome after ownership may be lost.
  }

  throw markExecutionLockLost(lockState, lockResource);
}

export function startLockHeartbeat(params: {
  store: IDurableStore;
  lockResource: string;
  lockId: string | "no-lock";
  lockTtlMs: number;
  lockState: ExecutionLockState;
}): () => void {
  if (params.lockId === "no-lock") return () => {};
  if (!params.store.renewLock) return () => {};

  const intervalMs = Math.max(1_000, Math.floor(params.lockTtlMs / 3));
  let stopped = false;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleRenewal = () => {
    heartbeatTimer = setTimeout(() => {
      heartbeatTimer = null;
      if (stopped) return;
      void params.store.renewLock!(
        params.lockResource,
        params.lockId,
        params.lockTtlMs,
      )
        .then((renewed) => {
          if (!renewed) {
            markExecutionLockLost(params.lockState, params.lockResource);
          }
        })
        .catch(() => {
          // A transient renew failure should not abandon the attempt outright;
          // outcome writes still re-check ownership against the store.
        })
        .finally(() => {
          if (!stopped && !params.lockState.lost) {
            scheduleRenewal();
          }
        });
    }, intervalMs);
    heartbeatTimer.unref?.();
  };

  scheduleRenewal();

  return () => {
    stopped = true;
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
  };
}
