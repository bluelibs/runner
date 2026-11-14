import { createCancellationErrorFromSignal } from "../../../../tools/abortSignals";
import {
  acquireStepAdmission,
  type StepAdmission,
} from "../managers/StepAdmissionController";
import type { ExecutionLockState } from "../managers/ExecutionManager.locking";
import { ContinuationSignal, SuspensionSignal } from "../interfaces/context";
import type {
  DurableStepConcurrency,
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
  loadStepRetryState,
  saveStepRetryCount,
} from "./DurableContext.stepRetryState";
import { createStepProgress } from "./stepProgress";
import type { DurableStepContext } from "../interfaces/context.step";

/** Runs bounded callback retries, retaining the successful lease through checkpointing. */
export async function runDurableStepAttempts<T>(params: {
  store: IDurableStore;
  executionId: string;
  workflowAttempt: number;
  identityExecutionId?: string;
  stepId: string;
  concurrency: DurableStepConcurrency | undefined;
  options: StepOptions;
  signal: AbortSignal;
  lockState: ExecutionLockState;
  upFn: (context: DurableStepContext) => Promise<T>;
  assertCanContinue: () => Promise<void>;
}): Promise<{ result: T; admission: StepAdmission | undefined }> {
  const maxRetries = params.options.retries ?? 0;
  const persistRetries = maxRetries > 0;
  const retry = persistRetries
    ? await loadStepRetryState(params)
    : { count: 0 };
  let attempts = retry.count;
  if (
    retry.nextAttemptAtMs !== undefined &&
    retry.nextAttemptAtMs > Date.now()
  ) {
    await sleepMs(retry.nextAttemptAtMs - Date.now());
    await params.assertCanContinue();
  }
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

    const progress = await createStepProgress({
      ...params,
      attempt: attempts + 1,
      heartbeatTimeoutMs: params.options.heartbeatTimeoutMs,
    });
    const signal = AbortSignal.any([params.signal, progress.signal]);
    try {
      const acquired = admission;
      const result =
        acquired || params.options.heartbeatTimeoutMs !== undefined
          ? await runAdmittedStepCallback({
              ...params,
              signal,
              upFn: (context) =>
                progress.run(context.signal, (step) =>
                  acquired
                    ? acquired.run(() => params.upFn(step))
                    : params.upFn(step),
                ),
              deferRelease: () => {
                admission = undefined;
              },
              release: acquired?.release ?? (async () => {}),
              stopRenewal: acquired?.stopRenewal,
            })
          : params.options.timeout
            ? await withTimeout(
                progress.run(params.signal, params.upFn),
                params.options.timeout,
                `Step ${params.stepId} timed out`,
              )
            : await progress.run(params.signal, params.upFn);
      return { result, admission };
    } catch (error) {
      progress.close();
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
      const nextAttemptAtMs = Date.now() + Math.pow(2, attempts) * 100;
      await saveStepRetryCount({ ...params, count: attempts, nextAttemptAtMs });
      await sleepMs(Math.max(0, nextAttemptAtMs - Date.now()));
      await params.assertCanContinue();
    } finally {
      progress.close();
    }
  }
}
