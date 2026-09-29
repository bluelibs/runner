import type { DurableStepRunContext, StepOptions } from "../interfaces/context";
import type { ExecutionLockState } from "../managers/ExecutionManager.locking";
import { createCancellationErrorFromSignal } from "../../../../tools/abortSignals";
import {
  EXECUTION_PAUSED_ABORT_REASON,
  throwDurablePauseInterruption,
} from "../pauseInterruption";
import { isTimeoutExceededError, withTimeout } from "../utils";

/** Admission callbacks receive cancellation when their permit can no longer be used. */
export async function runAdmittedStepCallback<T>(params: {
  stepId: string;
  options: StepOptions;
  signal: AbortSignal;
  lockState: ExecutionLockState;
  upFn: (context: DurableStepRunContext) => Promise<T>;
  deferRelease: () => void;
  release: () => Promise<void>;
  stopRenewal?: () => void;
}): Promise<T> {
  const controller = new AbortController();
  const signal = AbortSignal.any([params.signal, controller.signal]);
  let onAbort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => {
      try {
        if (signal.reason === EXECUTION_PAUSED_ABORT_REASON) {
          throwDurablePauseInterruption();
        }
        reject(
          createCancellationErrorFromSignal(
            signal,
            `Durable step '${params.stepId}' cancelled`,
          ),
        );
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

  let liveCallback: Promise<T> | undefined;
  let callbackSettled = false;
  try {
    if (signal.aborted) {
      onAbort();
      return await cancelled;
    }
    liveCallback = Promise.resolve().then(() => {
      signal.throwIfAborted();
      if (params.lockState.lost) throw params.lockState.lossError;
      return params.upFn({ signal });
    });
    void liveCallback.then(
      () => {
        callbackSettled = true;
      },
      () => {
        callbackSettled = true;
      },
    );
    const callback = Promise.race([
      liveCallback,
      cancelled,
      params.lockState.waitForLoss,
    ]);
    return params.options.timeout
      ? await withTimeout(
          callback,
          params.options.timeout,
          `Step ${params.stepId} timed out`,
        )
      : await callback;
  } catch (error) {
    if (isTimeoutExceededError(error) || params.lockState.lost) {
      controller.abort(error);
    }
    if (liveCallback && !callbackSettled) {
      // Retain capacity until settlement or lease expiry, without orphaning renewal timers.
      params.stopRenewal?.();
      params.deferRelease();
      void liveCallback.then(params.release, params.release).catch(() => {});
    }
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
