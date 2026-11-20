import { durableExecutionInvariantError } from "../../../../errors";
import type { ScheduleUpdate } from "../../core/interfaces/store";
import { ScheduleStatus, type Schedule, type Timer } from "../../core/types";
import type { SqlStoreRuntime } from "./runtime";
import { upsertTimerInTx } from "./timers";
import { forUpdate, type SqlExecutor } from "./types";

function assertStableScheduleIdentity(id: string, updates: object): void {
  const updatedId = Reflect.get(updates, "id");
  if (updatedId === undefined || updatedId === id) return;
  durableExecutionInvariantError.throw({
    message:
      `Cannot change durable schedule id from '${id}' to '${String(updatedId)}' via updateSchedule(). ` +
      "Create a new schedule instead.",
  });
}

async function upsertScheduleInTx(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  schedule: Schedule,
): Promise<void> {
  await tx.run(
    `INSERT INTO runner_durable_schedules (namespace, id, status, payload)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (namespace, id) DO UPDATE SET
       status = EXCLUDED.status,
       payload = EXCLUDED.payload`,
    [
      runtime.namespace,
      schedule.id,
      schedule.status,
      runtime.stringify(schedule),
    ],
  );
}

export async function createSchedule(
  runtime: SqlStoreRuntime,
  schedule: Schedule,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    await upsertScheduleInTx(runtime, tx, schedule);
  });
}

export async function getSchedule(
  runtime: SqlStoreRuntime,
  id: string,
): Promise<Schedule | null> {
  return runtime.withRead(async (exec) => {
    const row = await exec.get<{ payload: string }>(
      `SELECT payload FROM runner_durable_schedules WHERE namespace = ? AND id = ?`,
      [runtime.namespace, id],
    );
    return row ? runtime.parse<Schedule>(row.payload) : null;
  });
}

export async function updateSchedule(
  runtime: SqlStoreRuntime,
  id: string,
  updates: ScheduleUpdate,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    const row = await tx.get<{ payload: string }>(
      `SELECT payload FROM runner_durable_schedules
       WHERE namespace = ? AND id = ?${forUpdate(tx.dialect)}`,
      [runtime.namespace, id],
    );
    if (!row) return;
    assertStableScheduleIdentity(id, updates);
    const current = runtime.parse<Schedule>(row.payload);
    await upsertScheduleInTx(runtime, tx, { ...current, ...updates, id });
  });
}

export async function saveScheduleWithTimer(
  runtime: SqlStoreRuntime,
  schedule: Schedule,
  timer: Timer,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    await upsertScheduleInTx(runtime, tx, schedule);
    await upsertTimerInTx(runtime, tx, timer);
  });
}

export async function deleteSchedule(
  runtime: SqlStoreRuntime,
  id: string,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    await tx.run(
      `DELETE FROM runner_durable_schedules WHERE namespace = ? AND id = ?`,
      [runtime.namespace, id],
    );
  });
}

export async function listSchedules(
  runtime: SqlStoreRuntime,
): Promise<Schedule[]> {
  return runtime.withRead(async (exec) => {
    const rows = await exec.all<{ payload: string }>(
      `SELECT payload FROM runner_durable_schedules WHERE namespace = ? ORDER BY id ASC`,
      [runtime.namespace],
    );
    return rows.map((row) => runtime.parse<Schedule>(row.payload));
  });
}

export async function listActiveSchedules(
  runtime: SqlStoreRuntime,
): Promise<Schedule[]> {
  return runtime.withRead(async (exec) => {
    const rows = await exec.all<{ payload: string }>(
      `SELECT payload FROM runner_durable_schedules
       WHERE namespace = ? AND status = ?
       ORDER BY id ASC`,
      [runtime.namespace, ScheduleStatus.Active],
    );
    return rows.map((row) => runtime.parse<Schedule>(row.payload));
  });
}
