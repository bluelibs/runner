import type { DurableExecutionWaiter, StepResult } from "../../core/types";
import { parseExecutionWaitState } from "../../core/utils";
import { saveStepResultInTx } from "./executionViews";
import type { SqlStoreRuntime } from "./runtime";
import { forUpdate } from "./types";

export async function upsertExecutionWaiter(
  runtime: SqlStoreRuntime,
  waiter: DurableExecutionWaiter,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    await tx.run(
      `INSERT INTO runner_durable_execution_waiters (
        namespace, target_execution_id, execution_id, step_id, payload
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (namespace, target_execution_id, execution_id, step_id) DO UPDATE SET
        payload = EXCLUDED.payload`,
      [
        runtime.namespace,
        waiter.targetExecutionId,
        waiter.executionId,
        waiter.stepId,
        runtime.stringify(waiter),
      ],
    );
  });
}

export async function listExecutionWaiters(
  runtime: SqlStoreRuntime,
  targetExecutionId: string,
): Promise<DurableExecutionWaiter[]> {
  return runtime.withRead(async (exec) => {
    const rows = await exec.all<{ payload: string }>(
      `SELECT payload FROM runner_durable_execution_waiters
       WHERE namespace = ? AND target_execution_id = ?`,
      [runtime.namespace, targetExecutionId],
    );
    return rows.map((row) =>
      runtime.parse<DurableExecutionWaiter>(row.payload),
    );
  });
}

export async function commitExecutionWaiterCompletion(
  runtime: SqlStoreRuntime,
  params: {
    targetExecutionId: string;
    executionId: string;
    stepId: string;
    stepResult: StepResult;
    timerId?: string;
    waitTargetExecutionId?: string;
  },
): Promise<boolean> {
  return runtime.withWriteTx(async (tx) => {
    const waiterRow = await tx.get<{ step_id: string }>(
      `SELECT step_id FROM runner_durable_execution_waiters
       WHERE namespace = ? AND target_execution_id = ? AND execution_id = ? AND step_id = ?${forUpdate(tx.dialect)}`,
      [
        runtime.namespace,
        params.targetExecutionId,
        params.executionId,
        params.stepId,
      ],
    );
    if (!waiterRow) return false;

    const stepRow = await tx.get<{ payload: string }>(
      `SELECT payload FROM runner_durable_steps
       WHERE namespace = ? AND execution_id = ? AND step_id = ?${forUpdate(tx.dialect)}`,
      [runtime.namespace, params.executionId, params.stepId],
    );
    if (!stepRow) return false;

    const currentStep = runtime.parse<StepResult>(stepRow.payload);
    const waitState = parseExecutionWaitState(currentStep.result);
    const stepTargetAccepted =
      waitState?.targetExecutionId === params.targetExecutionId ||
      (params.waitTargetExecutionId !== undefined &&
        waitState?.targetExecutionId === params.waitTargetExecutionId);
    if (
      (waitState?.state !== "waiting" && waitState?.state !== "continued") ||
      !stepTargetAccepted
    ) {
      return false;
    }

    await saveStepResultInTx(runtime, tx, params.stepResult);
    await tx.run(
      `DELETE FROM runner_durable_execution_waiters
       WHERE namespace = ? AND target_execution_id = ? AND execution_id = ? AND step_id = ?`,
      [
        runtime.namespace,
        params.targetExecutionId,
        params.executionId,
        params.stepId,
      ],
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

export async function deleteExecutionWaiter(
  runtime: SqlStoreRuntime,
  targetExecutionId: string,
  executionId: string,
  stepId: string,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    await tx.run(
      `DELETE FROM runner_durable_execution_waiters
       WHERE namespace = ? AND target_execution_id = ? AND execution_id = ? AND step_id = ?`,
      [runtime.namespace, targetExecutionId, executionId, stepId],
    );
  });
}
