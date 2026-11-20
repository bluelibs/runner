import { TimerStatus, type Timer } from "../../core/types";
import { acquireOrRenewClaimInTx, timerClaimResource } from "./locks";
import type { SqlStoreRuntime } from "./runtime";
import { forUpdate, type SqlExecutor } from "./types";

export async function upsertTimerInTx(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  timer: Timer,
): Promise<void> {
  await tx.run(
    `INSERT INTO runner_durable_timers (
      namespace, id, execution_id, status, fire_at_ms, payload
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (namespace, id) DO UPDATE SET
      execution_id = EXCLUDED.execution_id,
      status = EXCLUDED.status,
      fire_at_ms = EXCLUDED.fire_at_ms,
      payload = EXCLUDED.payload`,
    [
      runtime.namespace,
      timer.id,
      timer.executionId ?? null,
      timer.status,
      timer.fireAt.getTime(),
      runtime.stringify(timer),
    ],
  );
}

export async function deleteTimerInTx(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  timerId: string,
): Promise<void> {
  await tx.run(
    `DELETE FROM runner_durable_timers WHERE namespace = ? AND id = ?`,
    [runtime.namespace, timerId],
  );
}

export async function createTimer(
  runtime: SqlStoreRuntime,
  timer: Timer,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    await upsertTimerInTx(runtime, tx, timer);
  });
}

export async function getReadyTimers(
  runtime: SqlStoreRuntime,
  now: Date = new Date(),
): Promise<Timer[]> {
  return runtime.withRead(async (exec) => {
    const rows = await exec.all<{ payload: string }>(
      `SELECT payload FROM runner_durable_timers
       WHERE namespace = ? AND status = ? AND fire_at_ms <= ?
       ORDER BY fire_at_ms ASC, id ASC`,
      [runtime.namespace, TimerStatus.Pending, now.getTime()],
    );
    return rows.map((row) => runtime.parse<Timer>(row.payload));
  });
}

export async function getExecutionTimers(
  runtime: SqlStoreRuntime,
  executionId: string,
): Promise<Timer[]> {
  return runtime.withRead(async (exec) => {
    const rows = await exec.all<{ payload: string }>(
      `SELECT payload FROM runner_durable_timers
       WHERE namespace = ? AND execution_id = ?
       ORDER BY fire_at_ms ASC, id ASC`,
      [runtime.namespace, executionId],
    );
    return rows.map((row) => runtime.parse<Timer>(row.payload));
  });
}

export async function markTimerFired(
  runtime: SqlStoreRuntime,
  timerId: string,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    const row = await tx.get<{ payload: string }>(
      `SELECT payload FROM runner_durable_timers
       WHERE namespace = ? AND id = ?${forUpdate(tx.dialect)}`,
      [runtime.namespace, timerId],
    );
    if (!row) return;
    const timer = runtime.parse<Timer>(row.payload);
    await upsertTimerInTx(runtime, tx, { ...timer, status: TimerStatus.Fired });
  });
}

export async function deleteTimer(
  runtime: SqlStoreRuntime,
  timerId: string,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    await deleteTimerInTx(runtime, tx, timerId);
  });
}

export async function claimReadyTimers(
  runtime: SqlStoreRuntime,
  now: Date,
  limit: number,
  workerId: string,
  ttlMs: number,
): Promise<Timer[]> {
  if (limit <= 0) return [];
  return runtime.withRawTx(async (tx) => {
    const nowMs = Date.now();
    const skipLocked =
      tx.dialect === "postgres" ? " FOR UPDATE OF t SKIP LOCKED" : "";
    const rows = await tx.all<{ id: string; payload: string }>(
      `SELECT t.id, t.payload FROM runner_durable_timers t
       LEFT JOIN runner_durable_locks l
         ON l.namespace = t.namespace
        AND l.resource = ('timer:claim:' || t.id)
        AND l.expires_at_ms > ?
       WHERE t.namespace = ? AND t.status = ? AND t.fire_at_ms <= ? AND l.resource IS NULL
       ORDER BY t.fire_at_ms ASC, t.id ASC
       LIMIT ?${skipLocked}`,
      [nowMs, runtime.namespace, TimerStatus.Pending, now.getTime(), limit],
    );
    const expiresAtMs = nowMs + ttlMs;
    for (const row of rows) {
      await tx.run(
        `INSERT INTO runner_durable_locks (namespace, resource, lock_id, expires_at_ms)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (namespace, resource) DO UPDATE SET
           lock_id = EXCLUDED.lock_id,
           expires_at_ms = EXCLUDED.expires_at_ms`,
        [runtime.namespace, timerClaimResource(row.id), workerId, expiresAtMs],
      );
    }
    return rows.map((row) => runtime.parse<Timer>(row.payload));
  });
}

export async function claimTimer(
  runtime: SqlStoreRuntime,
  timerId: string,
  workerId: string,
  ttlMs: number,
): Promise<boolean> {
  return runtime.withWriteTx((tx) =>
    acquireOrRenewClaimInTx(
      runtime,
      tx,
      timerClaimResource(timerId),
      workerId,
      ttlMs,
      false,
    ),
  );
}

export async function renewTimerClaim(
  runtime: SqlStoreRuntime,
  timerId: string,
  workerId: string,
  ttlMs: number,
): Promise<boolean> {
  return runtime.withWriteTx((tx) =>
    acquireOrRenewClaimInTx(
      runtime,
      tx,
      timerClaimResource(timerId),
      workerId,
      ttlMs,
      true,
    ),
  );
}

export async function releaseTimerClaim(
  runtime: SqlStoreRuntime,
  timerId: string,
  workerId: string,
): Promise<boolean> {
  return runtime.withWriteTx(async (tx) => {
    const resource = timerClaimResource(timerId);
    const nowMs = Date.now();
    const row = await tx.get<{
      lock_id: string;
      expires_at_ms: number | string;
    }>(
      `SELECT lock_id, expires_at_ms FROM runner_durable_locks
       WHERE namespace = ? AND resource = ?${forUpdate(tx.dialect)}`,
      [runtime.namespace, resource],
    );
    if (
      !row ||
      row.lock_id !== workerId ||
      Number(row.expires_at_ms) <= nowMs
    ) {
      return false;
    }
    await tx.run(
      `DELETE FROM runner_durable_locks WHERE namespace = ? AND resource = ?`,
      [runtime.namespace, resource],
    );
    return true;
  });
}

export async function finalizeClaimedTimer(
  runtime: SqlStoreRuntime,
  timerId: string,
  workerId: string,
): Promise<boolean> {
  return runtime.withWriteTx(async (tx) => {
    const resource = timerClaimResource(timerId);
    const nowMs = Date.now();
    const row = await tx.get<{
      lock_id: string;
      expires_at_ms: number | string;
    }>(
      `SELECT lock_id, expires_at_ms FROM runner_durable_locks
       WHERE namespace = ? AND resource = ?${forUpdate(tx.dialect)}`,
      [runtime.namespace, resource],
    );
    if (
      !row ||
      row.lock_id !== workerId ||
      Number(row.expires_at_ms) <= nowMs
    ) {
      return false;
    }
    await tx.run(
      `DELETE FROM runner_durable_locks WHERE namespace = ? AND resource = ?`,
      [runtime.namespace, resource],
    );
    await deleteTimerInTx(runtime, tx, timerId);
    return true;
  });
}
