import type { DurableAuditEntryInput } from "../audit";
import { DurableAuditEntryKind, isDurableInternalStepId } from "../audit";
import { SuspensionSignal } from "../interfaces/context";
import type {
  DurableStepRunContext,
  IStepBuilder,
  StepOptions,
} from "../interfaces/context";
import type { IDurableStore } from "../interfaces/store";
import { clearExecutionCurrent } from "../current";
import { ExecutionStatus, isExecutionTerminal } from "../types";
import { isTimeoutExceededError, sleepMs, withTimeout } from "../utils";
import { durableExecutionInvariantError } from "../../../../errors";
import { createCancellationErrorFromSignal } from "../../../../tools/abortSignals";

export type DurableCompensation = {
  stepId: string;
  action: () => Promise<void>;
};

function registerCompensation<T>(
  compensations: DurableCompensation[],
  stepId: string,
  result: T,
  downFn: (result: T) => Promise<void>,
): void {
  compensations.push({
    stepId,
    action: async () => downFn(result),
  });
}

export async function executeDurableStep<T>(params: {
  store: IDurableStore;
  executionId: string;
  assertCanContinue: () => Promise<void>;
  appendAuditEntry: (entry: DurableAuditEntryInput) => Promise<void>;
  setCurrent: () => Promise<void>;
  stepId: string;
  options: StepOptions;
  upFn: (context: DurableStepRunContext) => Promise<T>;
  signal: AbortSignal;
  downFn?: (result: T) => Promise<void>;
  compensations: DurableCompensation[];
}): Promise<T> {
  await params.assertCanContinue();

  const cached = await params.store.getStepResult(
    params.executionId,
    params.stepId,
  );
  if (cached) {
    const result = cached.result as T;
    await clearExecutionCurrent(params.store, params.executionId);
    if (params.downFn) {
      registerCompensation(
        params.compensations,
        params.stepId,
        result,
        params.downFn,
      );
    }
    return result;
  }

  await params.setCurrent();

  let attempts = 0;
  const maxRetries = params.options.retries ?? 0;
  const startedAt = Date.now();

  const executeWithRetry = async (): Promise<T> => {
    try {
      const context: DurableStepRunContext = { signal: params.signal };
      if (params.options.timeout) {
        return await withTimeout(
          params.upFn(context),
          params.options.timeout,
          `Step ${params.stepId} timed out`,
        );
      }
      return await params.upFn(context);
    } catch (error) {
      if (params.signal.aborted) {
        throw createCancellationErrorFromSignal(
          params.signal,
          `Durable step '${params.stepId}' cancelled`,
        );
      }

      if (isTimeoutExceededError(error)) {
        throw error;
      }

      if (attempts < maxRetries) {
        attempts += 1;
        await params.assertCanContinue();
        const delay = Math.pow(2, attempts) * 100;
        await sleepMs(delay);
        await params.assertCanContinue();
        return executeWithRetry();
      }
      throw error;
    }
  };

  const result = await executeWithRetry();
  const durationMs = Date.now() - startedAt;

  await params.assertCanContinue();

  await params.store.saveStepResult({
    executionId: params.executionId,
    stepId: params.stepId,
    result,
    completedAt: new Date(),
  });

  await params.appendAuditEntry({
    kind: DurableAuditEntryKind.StepCompleted,
    stepId: params.stepId,
    durationMs,
    isInternal: isDurableInternalStepId(params.stepId),
  });

  await clearExecutionCurrent(params.store, params.executionId);

  if (params.downFn) {
    registerCompensation(
      params.compensations,
      params.stepId,
      result,
      params.downFn,
    );
  }

  return result;
}

async function persistCompensationFailure(params: {
  store: IDurableStore;
  executionId: string;
  error: { message: string; stack?: string };
}): Promise<void> {
  const current = await params.store.getExecution(params.executionId);
  if (!current) {
    return;
  }
  // Never resurrect a terminal run or un-park a paused one: the operator's
  // terminal/park decision stands while the compensation error still
  // propagates to the caller.
  if (
    isExecutionTerminal(current.status) ||
    current.status === ExecutionStatus.Paused
  ) {
    return;
  }
  // Compare-and-set so a pause/cancel that commits first is never
  // overwritten; a lost race simply leaves the winner's status in place.
  await params.store.saveExecutionIfStatus(
    {
      ...current,
      status: ExecutionStatus.CompensationFailed,
      current: undefined,
      error: params.error,
      updatedAt: new Date(),
    },
    [current.status],
  );
}

export async function rollbackDurableCompensations(params: {
  store: IDurableStore;
  executionId: string;
  compensations: DurableCompensation[];
  assertUniqueStepId: (stepId: string) => void;
  internalStep: <T>(stepId: string, options?: StepOptions) => IStepBuilder<T>;
}): Promise<void> {
  const reversed = [...params.compensations].reverse();
  try {
    for (const comp of reversed) {
      const rollbackStepId = `rollback:${comp.stepId}`;
      params.assertUniqueStepId(rollbackStepId);

      await params
        .internalStep<{ rolledBack: true }>(rollbackStepId)
        .up(async () => {
          await comp.action();
          return { rolledBack: true };
        });
    }
  } catch (error) {
    if (error instanceof SuspensionSignal) throw error;

    const errorInfo = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };

    await persistCompensationFailure({
      store: params.store,
      executionId: params.executionId,
      error: errorInfo,
    });

    durableExecutionInvariantError.throw({
      message: "Compensation failed: " + errorInfo.message,
    });
  }
}
