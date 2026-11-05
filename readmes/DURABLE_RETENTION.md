# Successful Workflow History Collection

Durable resources can collect successful execution history immediately after completion or after a configured delay. This works for ordinary workflows and bridged events. The default retains history.

Partial example using an existing durable resource and backend configuration:

```ts
durable.with({
  ...backendConfig,
  retention: { onComplete: { afterMs: 86_400_000 } },
  garbageCollection: {
    enabled: true,
    intervalMs: 60_000,
    batchSize: 100,
  },
});
```

| Policy | Behavior |
| --- | --- |
| `{ onComplete: "retain" }` | Retain all history. Default. |
| `{ onComplete: "delete" }` | Collect history as soon as safely eligible. |
| `{ onComplete: { afterMs: number } }` | Collect after the completion time plus the non-negative finite delay. Zero means immediate eligibility. |

A deadline is eligibility, not an exact deletion time. The collector processes batches on its next interval. Its defaults are enabled, 60 seconds, and 100 executions per pass. Disable background collection with `garbageCollection.enabled: false` and call the backend's `collectCompletedHistory(now, limit)` explicitly when needed.

## Policy Precedence

For ordinary workflows, explicit start options override `tags.durableWorkflow.with({ retention })`, which overrides the resource default. For durable events, the event tag overrides bridge defaults, then the resource default. The execution stores its resolved policy at admission. Configuration changes affect subsequent executions.

Only successfully completed executions qualify. Running, pending, sleeping, paused, failed, cancelled, compensation-failed, and continuation predecessors retain their details. A failed business operation remains failed even after successful compensation.

Memory, persistent-memory, and Redis stores support collection. Custom stores must implement `collectCompletedHistory` to accept a deletion policy. Collector failures are logged and retried without changing the successful workflow outcome. Collector timers and in-flight passes stop with resource cooldown.

## What Collection Removes

Collection removes execution input, step receipts, audit history, workflow state, signal history/waiters, and execution-owned timers. It preserves the execution identity, terminal status, result, linkage, timestamps, and idempotency mappings as a completion receipt. `historyCollectedAt` distinguishes this receipt from a complete history.

Preserved results let existing and late callers use `durable.wait(id)` safely after collection. Completed children remain readable during parent replay. A compacted execution cannot be restarted from its deleted input; start a new workflow with explicit input instead.

Collection waits for completion ownership to release and for registered execution waiters to settle. A child retains details until its parent is known to have completed successfully. If the parent belongs to another backend, the collector conservatively retains child history because that backend cannot verify the parent's outcome. Continuation predecessor cleanup and cross-backend reference release are not implemented in this version.

Redis indexes successful deadlines atomically with execution writes. Each cleanup uses a compare-and-set Lua commit against the exact execution it read. Memory stores maintain a derived deadline index; persistent snapshots rebuild it on startup. Concurrent collectors can retry safely without resurrecting work or deleting an operator's changed record. Redis currently enumerates timer metadata to locate execution-owned timers; very large timer collections need an additional per-execution timer index before enabling aggressive cleanup.

## Storage Guarantees

This implementation retains completion receipts and deduplication mappings indefinitely. It does not implement the receipt-expiry window in the original [retention proposal](DURABLE_RETENTION_PROPOSAL.md). Successful history can be removed, but arbitrary future result reads require retaining the result somewhere.

Reusable schedule definitions and unrelated executions are never collected by this policy. Audit notifications are best effort and do not delay completion. Retention is local to the durable store namespace; it provides no atomic transaction with application databases or external services.
