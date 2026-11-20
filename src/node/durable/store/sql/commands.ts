import { isDeepStrictEqual } from "node:util";
import { durableExecutionInvariantError } from "../../../../errors";
import { check, Match } from "../../../../tools/check";
import {
  commandWakeupDelayMs,
  commandWakeupId,
  commandWakeupTimer,
} from "../../core/commandWakeup";
import type { DurableCommandRecord } from "../../core/interfaces/commands";
import { isExecutionTerminal, type Execution } from "../../core/types";
import { saveWorkflowStateInTx } from "./executionViews";
import { recordExecutionHistoryInTx } from "./historyAndCheckpoint";
import type { SqlStoreRuntime } from "./runtime";
import { deleteTimerInTx, upsertTimerInTx } from "./timers";
import { forUpdate, type SqlExecutor } from "./types";

async function lockCommandExecution(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  executionId: string,
): Promise<Execution | null> {
  const row = await tx.get<{ payload: string }>(
    `SELECT payload FROM runner_durable_executions WHERE namespace = ? AND id = ?${forUpdate(tx.dialect)}`,
    [runtime.namespace, executionId],
  );
  return row ? runtime.parse<Execution>(row.payload) : null;
}

async function readHeadCommandInTx(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  executionId: string,
): Promise<{ id: string; status: string } | null> {
  return tx.get<{ id: string; status: string }>(
    `SELECT id, status FROM runner_durable_commands
     WHERE namespace = ? AND execution_id = ? AND queue_seq IS NOT NULL
     ORDER BY queue_seq ASC LIMIT 1${forUpdate(tx.dialect)}`,
    [runtime.namespace, executionId],
  );
}

export async function rescheduleCommandTimer(
  runtime: SqlStoreRuntime,
  executionId: string,
  fireAt: Date,
): Promise<boolean> {
  return runtime.withWriteTx(async (tx) => {
    // An empty FIFO has no row to lock. Serialize with admission on its execution.
    await lockCommandExecution(runtime, tx, executionId);
    const head = await readHeadCommandInTx(runtime, tx, executionId);
    if (!head) {
      await deleteTimerInTx(runtime, tx, commandWakeupId(executionId));
      return false;
    }
    await upsertTimerInTx(runtime, tx, commandWakeupTimer(executionId, fireAt));
    return true;
  });
}

export async function enqueueCommand(
  runtime: SqlStoreRuntime,
  command: DurableCommandRecord,
): Promise<DurableCommandRecord> {
  return runtime.withWriteTx(async (tx) => {
    const execution = await lockCommandExecution(
      runtime,
      tx,
      command.executionId,
    );
    const existing = await tx.get<{ payload: string }>(
      `SELECT payload FROM runner_durable_commands WHERE namespace = ? AND id = ?`,
      [runtime.namespace, command.id],
    );
    if (existing) {
      return runtime.parse<DurableCommandRecord>(existing.payload);
    }

    if (
      !execution ||
      isExecutionTerminal(execution.status) ||
      execution.status === "cancelling" ||
      execution.workflowVersion !== command.workflowVersion
    ) {
      return durableExecutionInvariantError.throw({
        message:
          "Commands require a live execution with the accepted workflow version.",
      });
    }

    const seqRow = await tx.get<{ max_seq: number | string }>(
      `SELECT COALESCE(MAX(queue_seq), 0) AS max_seq FROM runner_durable_commands
       WHERE namespace = ? AND execution_id = ?`,
      [runtime.namespace, command.executionId],
    );
    const nextSeq = Number(seqRow!.max_seq) + 1;
    await tx.run(
      `INSERT INTO runner_durable_commands (
        namespace, id, execution_id, status, queue_seq, payload
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        runtime.namespace,
        command.id,
        command.executionId,
        command.status,
        nextSeq,
        runtime.stringify(command),
      ],
    );

    const wakeupId = commandWakeupId(command.executionId);
    const timerExists = await tx.get(
      `SELECT 1 AS ok FROM runner_durable_timers WHERE namespace = ? AND id = ?`,
      [runtime.namespace, wakeupId],
    );
    if (!timerExists) {
      await upsertTimerInTx(
        runtime,
        tx,
        commandWakeupTimer(
          command.executionId,
          new Date(Date.now() + commandWakeupDelayMs),
        ),
      );
    }
    return command;
  });
}

export async function getCommand(
  runtime: SqlStoreRuntime,
  commandId: string,
): Promise<DurableCommandRecord | null> {
  return runtime.withRead(async (exec) => {
    const row = await exec.get<{ payload: string }>(
      `SELECT payload FROM runner_durable_commands WHERE namespace = ? AND id = ?`,
      [runtime.namespace, commandId],
    );
    return row ? runtime.parse<DurableCommandRecord>(row.payload) : null;
  });
}

export async function getNextCommand(
  runtime: SqlStoreRuntime,
  executionId: string,
): Promise<DurableCommandRecord | null> {
  return runtime.withRead(async (exec) => {
    const row = await exec.get<{ payload: string }>(
      `SELECT payload FROM runner_durable_commands
       WHERE namespace = ? AND execution_id = ? AND queue_seq IS NOT NULL
       ORDER BY queue_seq ASC LIMIT 1`,
      [runtime.namespace, executionId],
    );
    return row ? runtime.parse<DurableCommandRecord>(row.payload) : null;
  });
}

export async function saveCommand(
  runtime: SqlStoreRuntime,
  command: DurableCommandRecord,
): Promise<boolean> {
  check(command.status, Match.OneOf("pending", "running"));
  return runtime.withWriteTx(async (tx) => {
    const head = await readHeadCommandInTx(runtime, tx, command.executionId);
    if (!head || head.id !== command.id) {
      return false;
    }
    await tx.run(
      `UPDATE runner_durable_commands SET status = ?, payload = ?
       WHERE namespace = ? AND id = ?`,
      [
        command.status,
        runtime.stringify(command),
        runtime.namespace,
        command.id,
      ],
    );
    return true;
  });
}

export async function completeCommand(
  runtime: SqlStoreRuntime,
  command: DurableCommandRecord,
  expected?: Execution,
): Promise<boolean> {
  check(command.status, Match.OneOf("completed", "failed"));
  const success = command.status === "completed";
  return runtime.withWriteTx(async (tx) => {
    const target = await lockCommandExecution(runtime, tx, command.executionId);
    const head = await readHeadCommandInTx(runtime, tx, command.executionId);
    if (!head || head.id !== command.id) {
      return false;
    }

    if (
      success &&
      (!expected ||
        !target ||
        isExecutionTerminal(target.status) ||
        target.status === "paused" ||
        target.status === "cancelling" ||
        !isDeepStrictEqual(target, expected))
    ) {
      return false;
    }

    if (success && command.state !== undefined) {
      if (command.state) {
        await saveWorkflowStateInTx(runtime, tx, {
          executionId: command.executionId,
          state: command.state.value,
          updatedAt: command.completedAt!,
        });
      } else {
        await tx.run(
          `DELETE FROM runner_durable_workflow_states WHERE namespace = ? AND execution_id = ?`,
          [runtime.namespace, command.executionId],
        );
      }
      if (target!.historyRecorded) {
        await recordExecutionHistoryInTx(runtime, tx, command.executionId, {
          kind: "command",
          stepId: `__command:${command.id}`,
          phase: "completed",
          stateAfter: command.state ?? null,
        });
      }
    }

    await tx.run(
      `UPDATE runner_durable_commands
       SET status = ?, queue_seq = NULL, payload = ?
       WHERE namespace = ? AND id = ?`,
      [
        command.status,
        runtime.stringify({ ...command, state: undefined }),
        runtime.namespace,
        command.id,
      ],
    );

    const remaining = await readHeadCommandInTx(
      runtime,
      tx,
      command.executionId,
    );
    if (!remaining) {
      await deleteTimerInTx(runtime, tx, commandWakeupId(command.executionId));
    } else {
      await upsertTimerInTx(
        runtime,
        tx,
        commandWakeupTimer(
          command.executionId,
          new Date(Date.now() + commandWakeupDelayMs),
        ),
      );
    }
    return true;
  });
}
