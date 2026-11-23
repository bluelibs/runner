import { randomUUID } from "node:crypto";
import type { SqlStoreRuntime } from "./runtime";
import { nowMsSql, type SqlExecutor } from "./types";

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
  const now = nowMsSql(tx.dialect);
  const row = requireExistingMatch
    ? await tx.get(
        `UPDATE runner_durable_locks SET expires_at_ms = (${now.expr}) + ?
         WHERE namespace = ? AND resource = ? AND lock_id = ? AND expires_at_ms > ${now.expr}
         RETURNING lock_id`,
        [
          ...now.params,
          ttlMs,
          runtime.namespace,
          resource,
          lockId,
          ...now.params,
        ],
      )
    : await tx.get(
        `INSERT INTO runner_durable_locks (namespace, resource, lock_id, expires_at_ms)
         VALUES (?, ?, ?, (${now.expr}) + ?)
         ON CONFLICT (namespace, resource) DO UPDATE SET
           lock_id = EXCLUDED.lock_id,
           expires_at_ms = EXCLUDED.expires_at_ms
         WHERE runner_durable_locks.expires_at_ms <= ${now.expr}
         RETURNING lock_id`,
        [
          runtime.namespace,
          resource,
          lockId,
          ...now.params,
          ttlMs,
          ...now.params,
        ],
      );
  return row !== null;
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
    const now = nowMsSql(exec.dialect);
    const row = await exec.get(
      `SELECT 1 AS ok FROM runner_durable_locks
       WHERE namespace = ? AND resource = ? AND expires_at_ms > ${now.expr}`,
      [runtime.namespace, `execution:${executionId}`, ...now.params],
    );
    return row !== null;
  });
}
