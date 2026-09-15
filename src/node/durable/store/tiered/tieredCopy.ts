import type { IDurableStore } from "../../core/interfaces/store";
import {
  durableExecutionInvariantError,
  durableOperatorUnsupportedStoreCapabilityError,
} from "../../../../errors";

/**
 * Size fingerprint of one execution's persisted history.
 *
 * Counts (never payloads) are compared because payloads may legitimately
 * differ across heterogeneous stores (Date revival, key order) while counts
 * stay exact.
 */
export interface ExecutionDataCounts {
  steps: number;
  audit: number;
  journals: Array<{ signalId: string; queued: number; history: number }>;
}

/**
 * Returns the store's `deleteExecutionData` capability or throws the standard
 * unsupported-capability error naming the tier that lacks it.
 */
export function requireExecutionDataDeletion(
  store: IDurableStore,
  tier: "hot" | "cold",
): (executionId: string) => Promise<void> {
  if (!store.deleteExecutionData) {
    return durableOperatorUnsupportedStoreCapabilityError.throw({
      operation: `deleteExecutionData (${tier} store)`,
    });
  }
  return async (executionId: string): Promise<void> => {
    await store.deleteExecutionData!(executionId);
  };
}

/**
 * Copies one execution's history (record, steps, audit, signal journals)
 * from `source` to `dest`, overwriting dest rows.
 *
 * Journal reconstruction is exact because `appendSignalRecord` only extends
 * history while `enqueueQueuedSignalRecord` only extends the queue.
 */
export async function copyExecutionData(params: {
  source: IDurableStore;
  dest: IDurableStore;
  executionId: string;
}): Promise<ExecutionDataCounts> {
  const execution = await params.source.getExecution(params.executionId);
  if (!execution) {
    return durableExecutionInvariantError.throw({
      message:
        `Cannot copy durable execution '${params.executionId}': ` +
        `it is missing from the source store.`,
    });
  }
  await params.dest.saveExecution(execution);

  const steps = await params.source.listStepResults(params.executionId);
  for (const step of steps) {
    await params.dest.saveStepResult(step);
  }

  const audit = params.source.listAuditEntries
    ? await params.source.listAuditEntries(params.executionId)
    : [];
  if (audit.length > 0) {
    if (!params.dest.appendAuditEntry) {
      return durableOperatorUnsupportedStoreCapabilityError.throw({
        operation: "appendAuditEntry",
      });
    }
    for (const entry of audit) {
      await params.dest.appendAuditEntry!(entry);
    }
  }

  const journals = params.source.listSignalStates
    ? await params.source.listSignalStates(params.executionId)
    : [];
  for (const journal of journals) {
    for (const record of journal.history) {
      await params.dest.appendSignalRecord(
        params.executionId,
        journal.signalId,
        record,
      );
    }
    for (const record of journal.queued) {
      await params.dest.enqueueQueuedSignalRecord(
        params.executionId,
        journal.signalId,
        record,
      );
    }
  }

  return {
    steps: steps.length,
    audit: audit.length,
    journals: journals.map((journal) => ({
      signalId: journal.signalId,
      queued: journal.queued.length,
      history: journal.history.length,
    })),
  };
}

/**
 * Reads the size fingerprint of one execution's history for copy verification.
 */
export async function countExecutionData(
  store: IDurableStore,
  executionId: string,
): Promise<ExecutionDataCounts> {
  const steps = await store.listStepResults(executionId);
  const audit = store.listAuditEntries
    ? await store.listAuditEntries(executionId)
    : [];
  const journals = store.listSignalStates
    ? await store.listSignalStates(executionId)
    : [];
  return {
    steps: steps.length,
    audit: audit.length,
    journals: journals.map((journal) => ({
      signalId: journal.signalId,
      queued: journal.queued.length,
      history: journal.history.length,
    })),
  };
}

/**
 * Whether two history fingerprints describe the same data volume.
 */
export function sameExecutionDataCounts(
  left: ExecutionDataCounts,
  right: ExecutionDataCounts,
): boolean {
  if (left.steps !== right.steps || left.audit !== right.audit) {
    return false;
  }
  if (left.journals.length !== right.journals.length) {
    return false;
  }
  const rightBySignal = new Map(
    right.journals.map((journal) => [journal.signalId, journal]),
  );
  return left.journals.every((journal) => {
    const other = rightBySignal.get(journal.signalId);
    return (
      !!other &&
      other.queued === journal.queued &&
      other.history === journal.history
    );
  });
}
