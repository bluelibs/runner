import { randomUUID } from "node:crypto";
import type { SqlStoreRuntime } from "./runtime";
import { forUpdate, type SqlExecutor } from "./types";

export function timerClaimResource(timerId: string): string {
  return `timer:claim:${timerId}`;
}

export async function acquireOrRenewClaimInTx(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  resource: string,
  lockId: string,
  ttlMs: number,
  requireExistingMatch: boolean,
): Promise<boolean> {
  const nowMs = Date.now();
  const row = await tx.get<{ lock_id: string; expires_at_ms: number | string }>(
    `SELECT lock_id, expires_at_ms FROM runner_durable_locks
     WHERE namespace = ? AND resource = ?${forUpdate(tx.dialect)}`,
    [runtime.namespace, resource],
  );
  if (requireExistingMatch) {
    if (!row || row.lock_id !== lockId || Number(row.expires_at_ms) <= nowMs) {
      return false;
    }
  } else if (row && Number(row.expires_at_ms) > nowMs) {
    return false;
  }
  await tx.run(
    `INSERT INTO runner_durable_locks (namespace, resource, lock_id, expires_at_ms)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (namespace, resource) DO UPDATE SET
       lock_id = EXCLUDED.lock_id,
       expires_at_ms = EXCLUDED.expires_at_ms`,
    [runtime.namespace, resource, lockId, nowMs + ttlMs],
  );
  return true;
}

export async function acquireLock(
  runtime: SqlStoreRuntime,
  resource: string,
  ttlMs: number,
): Promise<string | null> {
  const lockId = randomUUID();
  return runtime.withRawTx(async (tx) => {
    const acquired = await acquireOrRenewClaimInTx(
      runtime,
      tx,
      resource,
      lockId,
      ttlMs,
      false,
    );
    return acquired ? lockId : null;
  });
}

export async function renewLock(
  runtime: SqlStoreRuntime,
  resource: string,
  lockId: string,
  ttlMs: number,
): Promise<boolean> {
  return runtime.withRawTx((tx) =>
    acquireOrRenewClaimInTx(runtime, tx, resource, lockId, ttlMs, true),
  );
}

export async function releaseLock(
  runtime: SqlStoreRuntime,
  resource: string,
  lockId: string,
): Promise<void> {
  await runtime.withRawTx(async (tx) => {
    await tx.run(
      `DELETE FROM runner_durable_locks
       WHERE namespace = ? AND resource = ? AND lock_id = ?`,
      [runtime.namespace, resource, lockId],
    );
  });
}

export async function hasExecutionLease(
  runtime: SqlStoreRuntime,
  executionId: string,
): Promise<boolean> {
  return runtime.withRead(async (exec) => {
    const row = await exec.get<{ expires_at_ms: number | string }>(
      `SELECT expires_at_ms FROM runner_durable_locks
       WHERE namespace = ? AND resource = ?`,
      [runtime.namespace, `execution:${executionId}`],
    );
    return Boolean(row && Number(row.expires_at_ms) > Date.now());
  });
}
