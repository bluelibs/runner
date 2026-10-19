import { createCancellationErrorFromSignal } from "../../../../tools/abortSignals";
import {
  acquireStepAdmission,
  type StepAdmission,
} from "../managers/StepAdmissionController";
import type { ExecutionLockState } from "../managers/ExecutionManager.locking";
import { ContinuationSignal, SuspensionSignal } from "../interfaces/context";
import type {
  DurableStepConcurrency,
  DurableStepRunContext,
  StepOptions,
} from "../interfaces/context";
import type { IDurableStore } from "../interfaces/store";
import {
  EXECUTION_PAUSED_ABORT_REASON,
  throwDurablePauseInterruption,
} from "../pauseInterruption";
import { isTimeoutExceededError, sleepMs, withTimeout } from "../utils";
import { runAdmittedStepCallback } from "./DurableContext.stepCallback";
import {
  loadStepRetryCount,
  saveStepRetryCount,
} from "./DurableContext.stepRetryState";

/** Runs bounded callback retries, retaining the successful lease through checkpointing. */
export async function runDurableStepAttempts<T>(params: {
  store: IDurableStore;
  executionId: string;
  workflowAttempt: number;
  stepId: string;
  concurrency: DurableStepConcurrency | undefined;
  options: StepOptions;
  signal: AbortSignal;
  lockState: ExecutionLockState;
  upFn: (context: DurableStepRunContext) => Promise<T>;
  assertCanContinue: () => Promise<void>;
}): Promise<{ result: T; admission: StepAdmission | undefined }> {
  const maxRetries = params.options.retries ?? 0;
  const persistRetries = params.concurrency !== undefined && maxRetries > 0;
  let attempts = persistRetries ? await loadStepRetryCount(params) : 0;
  let admission: StepAdmission | undefined;

  while (true) {
    // Pause must win even when quick resume already restored the running record.
    if (params.signal.reason === EXECUTION_PAUSED_ABORT_REASON)
      throwDurablePauseInterruption();
    if (params.concurrency !== undefined) {
      admission = await acquireStepAdmission({
        ...params,
        policy: params.concurrency,
      });
    }

    try {
      const acquired = admission;
      const result = acquired
        ? await runAdmittedStepCallback({
            ...params,
            upFn: (context) => acquired.run(() => params.upFn(context)),
            deferRelease: () => {
              admission = undefined;
            },
            release: acquired.release,
            stopRenewal: acquired.stopRenewal,
          })
        : params.options.timeout
          ? await withTimeout(
              params.upFn({ signal: params.signal }),
              params.options.timeout,
              `Step ${params.stepId} timed out`,
            )
          : await params.upFn({ signal: params.signal });
      return { result, admission };
    } catch (error) {
      await admission?.release();
      admission = undefined;
      if (
        params.lockState.lost ||
        error instanceof SuspensionSignal ||
        error instanceof ContinuationSignal
      )
        throw error;
      if (params.signal.aborted) {
        throw createCancellationErrorFromSignal(
          params.signal,
          `Durable step '${params.stepId}' cancelled`,
        );
      }
      if (isTimeoutExceededError(error) || attempts >= maxRetries) throw error;
      attempts += 1;
      await params.assertCanContinue();
      if (persistRetries)
        await saveStepRetryCount({ ...params, count: attempts });
      await sleepMs(Math.pow(2, attempts) * 100);
      await params.assertCanContinue();
    }
  }
}
