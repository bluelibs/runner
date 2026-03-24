import type { IDurableStore } from "./interfaces/store";
import type { DurableSignalWaiter } from "./types";
import { durableExecutionInvariantError } from "../../../errors";
import { withStoreLock } from "./locking";
import { sleepMs } from "./utils";

const signalWaiterSortIndexWidth = 16;

export function getSignalLockResource(
  executionId: string,
  signalId: string,
): string {
  return `signal:${executionId}:${signalId}`;
}

/**
 * Creates a deterministic waiter sort key for a signal waiter step id.
 *
 * Base `__signal:${signalId}` waiters sort first, indexed `__signal:${signalId}:<n>`
 * waiters sort next by zero-padded numeric index, and all other stable/custom
 * step ids sort last.
 */
export function createSignalWaiterSortKey(
  signalId: string,
  stepId: string,
): string {
  const baseStepId = `__signal:${signalId}`;
  if (stepId === baseStepId) {
    return `0:${stepId}`;
  }

  if (stepId.startsWith(`${baseStepId}:`)) {
    const index = Number(stepId.slice(baseStepId.length + 1));
    if (Number.isInteger(index) && index >= 0) {
      return `1:${String(index).padStart(signalWaiterSortIndexWidth, "0")}:${stepId}`;
    }
  }

  return `2:${stepId}`;
}

export async function upsertSignalWaiter(params: {
  store: IDurableStore;
  executionId: string;
  signalId: string;
  stepId: string;
  timerId?: string;
}): Promise<void> {
  const waiter: DurableSignalWaiter = {
    executionId: params.executionId,
    signalId: params.signalId,
    stepId: params.stepId,
    sortKey: createSignalWaiterSortKey(params.signalId, params.stepId),
    timerId: params.timerId,
  };

  await params.store.upsertSignalWaiter(waiter);
}

export async function deleteSignalWaiter(params: {
  store: IDurableStore;
  executionId: string;
  signalId: string;
  stepId: string;
}): Promise<void> {
  await params.store.deleteSignalWaiter(
    params.executionId,
    params.signalId,
    params.stepId,
  );
}

export function getSignalIdFromStepId(stepId: string): string | null {
  if (!stepId.startsWith("__signal:")) return null;
  const suffix = stepId.slice("__signal:".length);
  if (suffix.length === 0) return null;

  const lastColonIndex = suffix.lastIndexOf(":");
  if (lastColonIndex === -1) {
    return suffix;
  }

  const possibleIndex = suffix.slice(lastColonIndex + 1);
  const parsedIndex = Number(possibleIndex);
  if (Number.isInteger(parsedIndex) && parsedIndex >= 0) {
    return suffix.slice(0, lastColonIndex);
  }

  return suffix;
}

export async function withSignalLock<TPayload>(params: {
  store: IDurableStore;
  executionId: string;
  signalId: string;
  fn: () => Promise<TPayload>;
}): Promise<TPayload> {
  return await withStoreLock({
    store: params.store,
    resource: getSignalLockResource(params.executionId, params.signalId),
    ttlMs: 10_000,
    maxAttempts: 20,
    retryDelayMs: 5,
    sleep: sleepMs,
    onLockUnavailable: () =>
      durableExecutionInvariantError.throw({
        message: `Failed to acquire signal lock for '${params.signalId}' on execution '${params.executionId}'`,
      }),
    fn: params.fn,
  });
}
