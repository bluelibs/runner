import type { DurableAuditEntryInput } from "../audit";
import { DurableAuditEntryKind, isDurableInternalStepId } from "../audit";
import { SuspensionSignal } from "../interfaces/context";
import type { IStepBuilder, StepOptions } from "../interfaces/context";
import type { IDurableStore } from "../interfaces/store";
import { ExecutionStatus } from "../types";
import { sleepMs, withTimeout } from "../utils";

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
  assertNotCancelled: () => Promise<void>;
  appendAuditEntry: (entry: DurableAuditEntryInput) => Promise<void>;
  stepId: string;
  options: StepOptions;
  upFn: () => Promise<T>;
  downFn?: (result: T) => Promise<void>;
  compensations: DurableCompensation[];
}): Promise<T> {
  await params.assertNotCancelled();

  const cached = await params.store.getStepResult(
    params.executionId,
    params.stepId,
  );
  if (cached) {
    const result = cached.result as T;
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

  let attempts = 0;
  const maxRetries = params.options.retries ?? 0;
  const startedAt = Date.now();

  const executeWithRetry = async (): Promise<T> => {
    try {
      if (params.options.timeout) {
        return await withTimeout(
          params.upFn(),
          params.options.timeout,
          `Step ${params.stepId} timed out`,
        );
      }
      return await params.upFn();
    } catch (error) {
      if (attempts < maxRetries) {
        attempts += 1;
        const delay = Math.pow(2, attempts) * 100;
        await sleepMs(delay);
        return executeWithRetry();
      }
      throw error;
    }
  };

  const result = await executeWithRetry();
  const durationMs = Date.now() - startedAt;

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

    await params.store.updateExecution(params.executionId, {
      status: ExecutionStatus.CompensationFailed,
      error: errorInfo,
      updatedAt: new Date(),
    });

    throw new Error("Compensation failed: " + errorInfo.message);
  }
}
