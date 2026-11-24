import { TimerStatus, type Timer } from "../../core/types";
import { acquireOrRenewClaimInTx, timerClaimResource } from "./locks";
import type { SqlStoreRuntime } from "./runtime";
import { forUpdate, nowMsSql, type SqlExecutor, type SqlParam } from "./types";

// Keep the parameter count bounded even for direct callers requesting a
// larger batch than the polling manager typically uses.
const MAX_CLAIM_BATCH_SIZE = 256;

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
    const nowClock = nowMsSql(tx.dialect);
    const skipLocked =
      tx.dialect === "postgres" ? " FOR UPDATE OF t SKIP LOCKED" : "";
    const rows = await tx.all<{ id: string; payload: string }>(
      `SELECT t.id, t.payload FROM runner_durable_timers t
       LEFT JOIN runner_durable_locks l
         ON l.namespace = t.namespace
        AND l.resource = ('timer:claim:' || t.id)
        AND l.expires_at_ms > ${nowClock.expr}
       WHERE t.namespace = ? AND t.status = ? AND t.fire_at_ms <= ? AND l.resource IS NULL
       ORDER BY t.fire_at_ms ASC, t.id ASC
       LIMIT ?${skipLocked}`,
      [
        ...nowClock.params,
        runtime.namespace,
        TimerStatus.Pending,
        now.getTime(),
        limit,
      ],
    );
    const claimed: Timer[] = [];
    for (let offset = 0; offset < rows.length; offset += MAX_CLAIM_BATCH_SIZE) {
      const batch = rows.slice(offset, offset + MAX_CLAIM_BATCH_SIZE);
      const resources = batch.map((row) => timerClaimResource(row.id));
      const claimClock = nowMsSql(tx.dialect);
      const tuple = `(?, ?, ?, (${claimClock.expr}) + ?)`;
      const params: SqlParam[] = [];
      for (const resource of resources) {
        params.push(
          runtime.namespace,
          resource,
          workerId,
          ...claimClock.params,
          ttlMs,
        );
      }
      // Timer rows are already locked. Recheck the claim at the conflicting
      // row since a direct claim can race with the initial SELECT.
      const acquired = await tx.all<{ resource: string }>(
        `INSERT INTO runner_durable_locks (namespace, resource, lock_id, expires_at_ms)
         VALUES ${batch.map(() => tuple).join(", ")}
         ON CONFLICT (namespace, resource) DO UPDATE SET
           lock_id = EXCLUDED.lock_id,
           expires_at_ms = EXCLUDED.expires_at_ms
         WHERE runner_durable_locks.expires_at_ms <= ${claimClock.expr}
         RETURNING resource`,
        [...params, ...claimClock.params],
      );
      const acquiredResources = new Set(acquired.map((row) => row.resource));
      for (const [index, row] of batch.entries()) {
        if (acquiredResources.has(resources[index])) {
          claimed.push(runtime.parse<Timer>(row.payload));
        }
      }
    }
    return claimed;
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
    const nowClock = nowMsSql(tx.dialect);
    const row = await tx.get<{
      lock_id: string;
      active: boolean | number;
    }>(
      `SELECT lock_id, (expires_at_ms > ${nowClock.expr}) AS active FROM runner_durable_locks
       WHERE namespace = ? AND resource = ?${forUpdate(tx.dialect)}`,
      [...nowClock.params, runtime.namespace, resource],
    );
    if (!row || row.lock_id !== workerId || !row.active) {
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
    // Batch claiming locks the timer before its claim.
    await tx.get(
      `SELECT id FROM runner_durable_timers WHERE namespace = ? AND id = ?${forUpdate(tx.dialect)}`,
      [runtime.namespace, timerId],
    );
    const resource = timerClaimResource(timerId);
    const nowClock = nowMsSql(tx.dialect);
    const row = await tx.get<{
      lock_id: string;
      active: boolean | number;
    }>(
      `SELECT lock_id, (expires_at_ms > ${nowClock.expr}) AS active FROM runner_durable_locks
       WHERE namespace = ? AND resource = ?${forUpdate(tx.dialect)}`,
      [...nowClock.params, runtime.namespace, resource],
    );
    if (!row || row.lock_id !== workerId || !row.active) {
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
