# Successful Workflow History Collection

Durable resources can collect successful execution history immediately after completion or after a configured delay. This works for ordinary workflows and bridged events. The default retains history.

Partial example using an existing durable resource and backend configuration:

```ts
durable.with({
  ...backendConfig,
  retention: {
    onComplete: { afterMs: 86_400_000 }, // Collect bulky step/signal/audit history after 1 day
    receipts: { afterMs: 604_800_000 }, // Optional: expire final completion receipts & idempotency keys after 7 days
  },
  garbageCollection: {
    enabled: true,
    intervalMs: 60_000,
    batchSize: 100,
  },
});
```

| Policy | Behavior |
| --- | --- |
| `{ onComplete: "retain" }` | Retain all history and receipts. Default. |
| `{ onComplete: "delete" }` | Collect history as soon as safely eligible. |
| `{ onComplete: { afterMs: number } }` | Collect history after completion time plus non-negative finite delay. Zero means immediate eligibility. |
| `receipts: "retain" \| "delete" \| { afterMs }` | Optional receipt expiry schedule. Cannot expire earlier than `onComplete`. `{ onComplete: "retain", receipts: { afterMs } }` deletes history and receipt together in one pass. |

A deadline is eligibility, not an exact deletion time. The collector processes batches on its next interval. Its defaults are enabled, 60 seconds, and 100 executions per pass. Disable background collection with `garbageCollection.enabled: false` and call the backend's `collectCompletedHistory(now, limit)` or `collectExpiredReceipts(now, limit)` explicitly when needed.

## Policy Precedence

For ordinary workflows, explicit start options override `tags.durableWorkflow.with({ retention })`, which overrides the resource default. For durable events, the event tag overrides bridge defaults, then the resource default. The execution stores its resolved policy at admission. Configuration changes affect subsequent executions. Configuring `receipts` fails fast if `receipts` expires earlier than `onComplete` or if the store lacks `collectExpiredReceipts`.

Only successfully completed executions qualify. Running, pending, sleeping, paused, failed, cancelled, compensation-failed, and continuation predecessors retain their details. A failed business operation remains failed even after successful compensation.

Memory, persistent-memory, Redis, SQLite, and PostgreSQL stores support both history collection and receipt expiry. Custom stores must implement `collectCompletedHistory` to accept an `onComplete` deletion policy and `collectExpiredReceipts` to accept a `receipts` expiry policy. Collector failures are logged and retried without changing the successful workflow outcome. Collector timers and in-flight passes stop with resource cooldown.

## What Collection Removes

History collection (`onComplete`) removes execution input, step receipts, audit history, workflow state, signal history/waiters, and execution-owned timers. It preserves the execution identity, terminal status, result, linkage, timestamps, and idempotency mappings as a completion receipt. `historyCollectedAt` distinguishes this receipt from a complete history.

Receipt expiry (`receipts`) goes further once eligible: it removes the execution record itself, remaining execution-owned details, execution-scoped command receipts, execution waiters, and the idempotency mapping so future requests with the same idempotency key start fresh executions. Like history collection, receipt expiry waits until parent completion (when nested), active execution locks, active execution waiters, and pending queued commands clear.

Preserved results let existing and late callers use `durable.wait(id)` safely after history collection until the optional `receipts` deadline expires. Completed children remain readable during parent replay. A compacted execution cannot be restarted from its deleted input; start a new workflow with explicit input instead.

Collection waits for completion ownership to release and for registered execution waiters to settle. A child retains details until its parent is known to have completed successfully. If the parent belongs to another backend, the collector conservatively retains child history because that backend cannot verify the parent's outcome. Continuation predecessor cleanup and cross-backend reference release are not implemented in this version.

Redis indexes successful deadlines and receipt expiry deadlines atomically with execution writes. Each cleanup uses a compare-and-set Lua commit against the exact execution it read. Memory stores maintain derived deadline indexes; persistent snapshots rebuild them on startup. SQLite and PostgreSQL stores index deadlines inline inside transactional execution tables and delete dependent rows within one ACID transaction.

## Storage Guarantees

By default (when `receipts` is omitted or `"retain"`), completion receipts and deduplication mappings remain indefinitely so late callers can read `durable.wait(id)` and deduplicate retries. Opt into `retention.receipts` when bounded storage of completion receipts and idempotency keys is desired.

Reusable schedule definitions and unrelated executions are never collected by this policy. Audit notifications are best effort and do not delay completion. Retention is local to the durable store namespace; it provides no atomic transaction with application databases or external services.
