import {
  durableExecutionInvariantError,
  durableSignalBacklogExceededError,
} from "../../../../errors";
import { getSignalIdFromStepId } from "../../core/signalWaiters";
import {
  MAX_QUEUED_SIGNALS_PER_KEY,
  MAX_SIGNAL_HISTORY_PER_KEY,
  type DurableQueuedSignalRecord,
  type DurableSignalRecord,
  type DurableSignalState,
  type StepResult,
} from "../../core/types";
import { saveStepResultInTx } from "./executionViews";
import type { SqlStoreRuntime } from "./runtime";
import { forUpdate, type SqlExecutor } from "./types";

function createEmptySignalState(
  executionId: string,
  signalId: string,
): DurableSignalState {
  return { executionId, signalId, history: [], queued: [] };
}

function toSignalRecord(record: DurableSignalRecord): DurableSignalRecord {
  return {
    id: record.id,
    payload: record.payload,
    receivedAt: record.receivedAt,
  };
}

function assertQueueCapacity(
  executionId: string,
  signalId: string,
  queuedLength: number,
  incomingCount = 1,
): void {
  if (queuedLength + incomingCount > MAX_QUEUED_SIGNALS_PER_KEY) {
    durableSignalBacklogExceededError.throw({
      executionId,
      signalId,
      limit: MAX_QUEUED_SIGNALS_PER_KEY,
    });
  }
}

export function trimHistory(history: DurableSignalRecord[]): void {
  if (history.length > MAX_SIGNAL_HISTORY_PER_KEY) {
    history.splice(0, history.length - MAX_SIGNAL_HISTORY_PER_KEY);
  }
}

export async function readSignalStateForUpdate(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  executionId: string,
  signalId: string,
): Promise<DurableSignalState | null> {
  const row = await tx.get<{ payload: string }>(
    `SELECT payload FROM runner_durable_signal_states
     WHERE namespace = ? AND execution_id = ? AND signal_id = ?${forUpdate(tx.dialect)}`,
    [runtime.namespace, executionId, signalId],
  );
  return row ? runtime.parse<DurableSignalState>(row.payload) : null;
}

export async function ensureSignalStateForUpdate(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  executionId: string,
  signalId: string,
): Promise<DurableSignalState> {
  const existing = await readSignalStateForUpdate(
    runtime,
    tx,
    executionId,
    signalId,
  );
  if (existing) return existing;

  // PostgreSQL cannot lock a missing row. Claim the key before reading its value.
  const state = createEmptySignalState(executionId, signalId);
  const row = await tx.get<{ payload: string }>(
    `INSERT INTO runner_durable_signal_states (namespace, execution_id, signal_id, payload)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (namespace, execution_id, signal_id) DO UPDATE
     SET payload = runner_durable_signal_states.payload
     RETURNING payload`,
    [runtime.namespace, executionId, signalId, runtime.stringify(state)],
  );
  return runtime.parse<DurableSignalState>(row!.payload);
}

export async function writeSignalStateInTx(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  state: DurableSignalState,
): Promise<void> {
  await tx.run(
    `INSERT INTO runner_durable_signal_states (namespace, execution_id, signal_id, payload)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (namespace, execution_id, signal_id) DO UPDATE SET payload = EXCLUDED.payload`,
    [
      runtime.namespace,
      state.executionId,
      state.signalId,
      runtime.stringify(state),
    ],
  );
}

export async function getSignalState(
  runtime: SqlStoreRuntime,
  executionId: string,
  signalId: string,
): Promise<DurableSignalState | null> {
  return runtime.withRead(async (exec) => {
    const row = await exec.get<{ payload: string }>(
      `SELECT payload FROM runner_durable_signal_states
       WHERE namespace = ? AND execution_id = ? AND signal_id = ?`,
      [runtime.namespace, executionId, signalId],
    );
    return row ? runtime.parse<DurableSignalState>(row.payload) : null;
  });
}

export async function listSignalStates(
  runtime: SqlStoreRuntime,
  executionId: string,
): Promise<DurableSignalState[]> {
  return runtime.withRead(async (exec) => {
    const rows = await exec.all<{ payload: string }>(
      `SELECT payload FROM runner_durable_signal_states
       WHERE namespace = ? AND execution_id = ?`,
      [runtime.namespace, executionId],
    );
    return rows
      .map((row) => runtime.parse<DurableSignalState>(row.payload))
      .sort((left, right) => left.signalId.localeCompare(right.signalId));
  });
}

export async function appendSignalRecord(
  runtime: SqlStoreRuntime,
  executionId: string,
  signalId: string,
  record: DurableSignalRecord,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    const state = await ensureSignalStateForUpdate(
      runtime,
      tx,
      executionId,
      signalId,
    );
    state.history.push(toSignalRecord(record));
    trimHistory(state.history);
    await writeSignalStateInTx(runtime, tx, state);
  });
}

export async function bufferSignalRecord(
  runtime: SqlStoreRuntime,
  executionId: string,
  signalId: string,
  record: DurableQueuedSignalRecord,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    const state = await ensureSignalStateForUpdate(
      runtime,
      tx,
      executionId,
      signalId,
    );
    assertQueueCapacity(executionId, signalId, state.queued.length);
    state.history.push(toSignalRecord(record));
    trimHistory(state.history);
    state.queued.push(record);
    await writeSignalStateInTx(runtime, tx, state);
  });
}

export async function enqueueQueuedSignalRecord(
  runtime: SqlStoreRuntime,
  executionId: string,
  signalId: string,
  record: DurableQueuedSignalRecord,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    const state = await ensureSignalStateForUpdate(
      runtime,
      tx,
      executionId,
      signalId,
    );
    assertQueueCapacity(executionId, signalId, state.queued.length);
    state.queued.push(record);
    await writeSignalStateInTx(runtime, tx, state);
  });
}

export async function consumeQueuedSignalRecord(
  runtime: SqlStoreRuntime,
  executionId: string,
  signalId: string,
): Promise<DurableSignalRecord | null> {
  return runtime.withWriteTx(async (tx) => {
    const state = await readSignalStateForUpdate(
      runtime,
      tx,
      executionId,
      signalId,
    );
    const next = state?.queued.shift();
    if (!state || !next) return null;
    await writeSignalStateInTx(runtime, tx, state);
    return toSignalRecord(next);
  });
}

function resolveSignalIdFromStepResult(result: StepResult): string {
  const state = result.result;
  if (
    typeof state === "object" &&
    state !== null &&
    "signalId" in state &&
    typeof state.signalId === "string"
  ) {
    return state.signalId;
  }
  const signalId = getSignalIdFromStepId(result.stepId);
  if (signalId) return signalId;
  return durableExecutionInvariantError.throw({
    message: `Unable to resolve signal id for buffered step '${result.stepId}' on execution '${result.executionId}'.`,
  });
}

export async function consumeBufferedSignalForStep(
  runtime: SqlStoreRuntime,
  stepResult: StepResult,
): Promise<DurableSignalRecord | null> {
  const signalId = resolveSignalIdFromStepResult(stepResult);

  return runtime.withWriteTx(async (tx) => {
    const state = await readSignalStateForUpdate(
      runtime,
      tx,
      stepResult.executionId,
      signalId,
    );
    const next = state?.queued.shift();
    if (!state || !next) return null;

    const nextStepResult =
      typeof stepResult.result === "object" && stepResult.result !== null
        ? { ...stepResult.result, payload: next.payload }
        : stepResult.result;

    await writeSignalStateInTx(runtime, tx, state);
    await saveStepResultInTx(runtime, tx, {
      ...stepResult,
      result: nextStepResult,
    });
    return toSignalRecord(next);
  });
}

export async function transferQueuedSignalBacklogInTx(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  fromExecutionId: string,
  toExecutionId: string,
): Promise<void> {
  const rows = await tx.all<{ payload: string }>(
    `SELECT payload FROM runner_durable_signal_states
     WHERE namespace = ? AND execution_id = ?
     ORDER BY signal_id ASC${forUpdate(tx.dialect)}`,
    [runtime.namespace, fromExecutionId],
  );
  const backlogs = rows
    .map((row) => runtime.parse<DurableSignalState>(row.payload))
    .filter((state) => state.queued.length > 0);
  if (backlogs.length === 0) return;

  const targets = new Map<string, DurableSignalState>();
  for (const backlog of backlogs) {
    const target = await ensureSignalStateForUpdate(
      runtime,
      tx,
      toExecutionId,
      backlog.signalId,
    );
    assertQueueCapacity(
      toExecutionId,
      backlog.signalId,
      target.queued.length,
      backlog.queued.length,
    );
    targets.set(backlog.signalId, target);
  }

  for (const backlog of backlogs) {
    const target = targets.get(backlog.signalId)!;
    target.queued.push(...backlog.queued);
    backlog.queued = [];
    await writeSignalStateInTx(runtime, tx, target);
    await writeSignalStateInTx(runtime, tx, backlog);
  }
}
