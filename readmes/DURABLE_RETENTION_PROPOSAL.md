# Durable Workflow Retention

> **Implementation:** See [DURABLE_RETENTION.md](DURABLE_RETENTION.md) for the implemented contract and current limitations. This document retains the broader design proposal.

> **Status: Design proposal.** The implementation guide linked above is authoritative for available APIs and behavior. This proposal also describes deferred capabilities.

Successful workflows often need recovery while running but little history afterward. Retention lets the durable runtime collect completed execution data immediately or after a configured interval. The same policy serves ordinary workflows and the [durable event bridge](DURABLE_EVENTS_PROPOSAL.md).

Completion must be durable before deletion is eligible. A successful callback alone does not mean its execution can be removed.

## Configure Retention

Proposed additions to workflow resource configuration:

```ts
const durable = resources.redisWorkflow.fork("workflows");

// Partial configuration: retain the application's existing Redis settings.
durable.with({
  ...backendConfig,
  retention: {
    onComplete: { afterMs: 86_400_000 },
  },
  garbageCollection: {
    enabled: true,
    intervalMs: 60_000,
    batchSize: 100,
  },
});
```

| `onComplete` | Meaning |
| --- | --- |
| `"retain"` | Keep successful execution history. Default. |
| `"delete"` | Eligible for collection immediately after durable completion. |
| `{ afterMs: number }` | Eligible at `completedAt + afterMs`. Non-negative finite milliseconds; zero means immediate eligibility. |

This is an eligibility deadline, not a promise of exact deletion time. Collection can run later because of its interval, shutdown, backend availability, or retained dependencies.

Add the same `retention` property to `tags.durableWorkflow.with(...)` for workflow-specific overrides and to ordinary workflow start options for an individual execution. Ordinary workflow precedence is explicit start override, workflow definition, then durable-resource defaults. Bridged events are triggered by ordinary emission; their precedence is event tag, bridge defaults, then durable-resource defaults. They require no separate start API. Persist the resolved policy at admission so configuration changes do not retroactively erase history.

Only successful `completed` executions are eligible in this first contract. Failed, cancelled, compensation-failed, paused, pending, and running executions are retained. A failed operation whose compensation succeeded is still a failed operation. Continuation predecessors are handled as part of their completed chain, not independently while successors are active.

## Completion And Collection

1. Commit the successful result and status, resolve durable waiter state, and set `deleteAfter` atomically with a durable cleanup-index entry.
2. A collector queries due entries in bounded batches and claims them with a lease. Store state, not a process-local timer, owns the deletion schedule.
3. Recheck status, ownership, continuation links, and outstanding references before deletion. Operator actions and collection must coordinate atomically; a stale claim cannot erase a restarted execution.
4. Delete execution-owned details idempotently: step results, compensation receipts, audit entries, consumed signals, obsolete timers, resolved waiters, and associated indexes. Do not delete reusable schedule definitions or unrelated executions.
5. Finalize collection only when all owned data is removed. A crash mid-batch resumes safely without reviving execution or corrupting shared indexes.

The collector is owned by the durable resource, isolated by its namespace, and stopped/drained during lifecycle teardown. Multiple processes may collect from a shared store using claims. Persistent memory stores persist collection metadata; memory-only stores collect only for their instance lifetime.

Default collection settings are `enabled: true`, `intervalMs: 60_000`, and `batchSize: 100`; no loop is needed when there is no cleanup work. With collection disabled, eligibility records remain durable for another configured collector or later startup. A custom store lacking the required capabilities must reject configured deletion rather than ignore it. Store interfaces need explicit atomic completion/indexing, claiming, and deletion contracts before implementation.

No workflow or timer is created for each deletion. Otherwise the cleanup system would need another cleanup system, and nobody gets to go home.

## Completion Receipts And Replay Safety

Immediate deletion cannot mean erasing every trace at callback return. A parent may be suspended waiting for the result, a queue may redeliver, or the caller may reconnect after completion.

Retain a compact completion receipt containing execution identity, terminal outcome/result as needed, completion time, workflow identity, and deduplication references. It is separate from full workflow history. Deleting details reduces storage without making a completed execution appear never to have existed.

Protect completion receipts while any active parent, continuation chain, or durable waiter needs them. Parent replay must still obtain its child's result. Active relationships are persisted references, not inferred from in-memory callbacks. A parent that needs to compensate a successful child must protect that child's compensation data too; until that protocol exists, reject cleanup for that relationship.

For unreferenced receipts, propose `retention.receiptTtlMs`, defaulting to 86,400,000 milliseconds after completion. Expiry requires both the deadline and absence of protected references. This defines the supported late-result and deduplication window; it is not a bound on how long a live parent may suspend.

Queue redelivery of an expired execution identity must acknowledge/discard the missing execution, never recreate it. Explicit idempotency-key mappings expire with their receipt: reusing a key afterward can start new work. Integrations needing longer deduplication must configure a longer receipt window or maintain domain-level deduplication.

`wait(executionId)` and dependent parent replay read a retained completion receipt after full details are collected. Detail queries indicate collected history while that receipt exists. After the receipt itself expires, lookup fails with a typed unavailable-result error; it must not poll forever or invent a result. Callers using immediate cleanup accept that old diagnostic history is unavailable.

The collector must not race an already-registered waiter. Parent completion delivery, result retention, and reference release need store-backed atomic transitions. Best-effort bus notifications alone cannot protect results.

## Operational Rules

- A collection failure is maintenance failure, not workflow failure. Retry it and expose diagnostics without changing the successful business outcome.
- Collect only after all required successful-completion bookkeeping is committed. Optional audit delivery does not hold workflow correctness hostage.
- Retention does not promise atomicity with the application's own database or external effects.
- Large results may dominate receipt size. Retain them while needed for the result contract; do not claim zero storage while preserving arbitrary future reads.
- Setting a shorter policy affects newly admitted executions. Bulk retroactive deletion is a separate explicit operator action, outside this proposal.

## Acceptance Criteria

- [ ] Default behavior retains existing workflow history.
- [ ] Immediate, zero-delay, and delayed policies produce the correct persisted eligibility time.
- [ ] Definition and start overrides resolve deterministically and survive restart.
- [ ] Only successful executions become eligible; incomplete compensation is never collected.
- [ ] Collector restart, duplicate claims, lease loss, and interrupted deletion are safe.
- [ ] Collection removes owned data and indexes without removing reusable schedules or unrelated runs.
- [ ] Waiting callers and suspended parents receive completed results during collection races.
- [ ] Continuation and compensation dependencies prevent premature deletion.
- [ ] Receipts expire only after their window and protected references permit it; late duplicate delivery does not recreate work.
- [ ] Operator restart races cannot erase new work; unsupported backends fail at configuration time.
- [ ] Memory, persistent-memory, and Redis implementations honor the same contract and runtime isolation.
