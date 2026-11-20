import type {
  DurableSignalRecord,
  DurableSignalWaiter,
  StepResult,
} from "../../core/types";
import { parseSignalState } from "../../core/utils";
import { saveStepResultInTx } from "./executionViews";
import type { SqlStoreRuntime } from "./runtime";
import { readSignalStateForUpdate, writeSignalStateInTx } from "./signalState";
import { forUpdate } from "./types";

export async function upsertSignalWaiter(
  runtime: SqlStoreRuntime,
  waiter: DurableSignalWaiter,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    await tx.run(
      `INSERT INTO runner_durable_signal_waiters (
        namespace, execution_id, signal_id, step_id, sort_key, payload
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (namespace, execution_id, signal_id, step_id) DO UPDATE SET
        sort_key = EXCLUDED.sort_key,
        payload = EXCLUDED.payload`,
      [
        runtime.namespace,
        waiter.executionId,
        waiter.signalId,
        waiter.stepId,
        waiter.sortKey,
        runtime.stringify(waiter),
      ],
    );
  });
}

export async function peekNextSignalWaiter(
  runtime: SqlStoreRuntime,
  executionId: string,
  signalId: string,
): Promise<DurableSignalWaiter | null> {
  return runtime.withRead(async (exec) => {
    const row = await exec.get<{ payload: string }>(
      `SELECT payload FROM runner_durable_signal_waiters
       WHERE namespace = ? AND execution_id = ? AND signal_id = ?
       ORDER BY sort_key ASC, step_id ASC
       LIMIT 1`,
      [runtime.namespace, executionId, signalId],
    );
    return row ? runtime.parse<DurableSignalWaiter>(row.payload) : null;
  });
}

export async function commitSignalDelivery(
  runtime: SqlStoreRuntime,
  params: {
    executionId: string;
    signalId: string;
    stepId: string;
    stepResult: StepResult;
    signalRecord: DurableSignalRecord;
    timerId?: string;
  },
): Promise<boolean> {
  return runtime.withWriteTx(async (tx) => {
    const stepRow = await tx.get<{ payload: string }>(
      `SELECT payload FROM runner_durable_steps
       WHERE namespace = ? AND execution_id = ? AND step_id = ?${forUpdate(tx.dialect)}`,
      [runtime.namespace, params.executionId, params.stepId],
    );
    if (!stepRow) return false;

    const currentStep = runtime.parse<StepResult>(stepRow.payload);
    const signalState = parseSignalState(currentStep.result);
    if (
      signalState?.state !== "waiting" ||
      (signalState.signalId !== undefined &&
        signalState.signalId !== params.signalId)
    ) {
      return false;
    }

    const waiterRow = await tx.get<{ step_id: string }>(
      `SELECT step_id FROM runner_durable_signal_waiters
       WHERE namespace = ? AND execution_id = ? AND signal_id = ? AND step_id = ?${forUpdate(tx.dialect)}`,
      [runtime.namespace, params.executionId, params.signalId, params.stepId],
    );
    if (!waiterRow) return false;

    await saveStepResultInTx(runtime, tx, params.stepResult);
    const journal = (await readSignalStateForUpdate(
      runtime,
      tx,
      params.executionId,
      params.signalId,
    )) ?? {
      executionId: params.executionId,
      signalId: params.signalId,
      history: [],
      queued: [],
    };
    journal.history.push({
      id: params.signalRecord.id,
      payload: params.signalRecord.payload,
      receivedAt: params.signalRecord.receivedAt,
    });
    await writeSignalStateInTx(runtime, tx, journal);

    await tx.run(
      `DELETE FROM runner_durable_signal_waiters
       WHERE namespace = ? AND execution_id = ? AND signal_id = ? AND step_id = ?`,
      [runtime.namespace, params.executionId, params.signalId, params.stepId],
    );
    if (params.timerId) {
      await tx.run(
        `DELETE FROM runner_durable_timers WHERE namespace = ? AND id = ?`,
        [runtime.namespace, params.timerId],
      );
    }
    return true;
  });
}

export async function takeNextSignalWaiter(
  runtime: SqlStoreRuntime,
  executionId: string,
  signalId: string,
): Promise<DurableSignalWaiter | null> {
  return runtime.withWriteTx(async (tx) => {
    const row = await tx.get<{ step_id: string; payload: string }>(
      `SELECT step_id, payload FROM runner_durable_signal_waiters
       WHERE namespace = ? AND execution_id = ? AND signal_id = ?
       ORDER BY sort_key ASC, step_id ASC
       LIMIT 1${forUpdate(tx.dialect)}`,
      [runtime.namespace, executionId, signalId],
    );
    if (!row) return null;

    await tx.run(
      `DELETE FROM runner_durable_signal_waiters
       WHERE namespace = ? AND execution_id = ? AND signal_id = ? AND step_id = ?`,
      [runtime.namespace, executionId, signalId, row.step_id],
    );
    return runtime.parse<DurableSignalWaiter>(row.payload);
  });
}

export async function deleteSignalWaiter(
  runtime: SqlStoreRuntime,
  executionId: string,
  signalId: string,
  stepId: string,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    await tx.run(
      `DELETE FROM runner_durable_signal_waiters
       WHERE namespace = ? AND execution_id = ? AND signal_id = ? AND step_id = ?`,
      [runtime.namespace, executionId, signalId, stepId],
    );
  });
}
