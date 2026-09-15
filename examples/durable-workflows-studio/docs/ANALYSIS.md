# Durable Workflows — Engine Analysis

What the studio learned about Runner's durable engine, how each concept maps
to the UI, and the framework gaps found along the way. All paths are relative
to the repository root.

## 1. Primitives (`IDurableContext`)

| Primitive | Durability story |
| --- | --- |
| `step(id, fn)` | memoized by `stepId`; replays return the stored result |
| `sleep(ms, { stepId })` | persists a timer + marker, suspends, resumes via poller |
| `waitForSignal(signal, { stepId, timeoutMs })` | suspends; FIFO queue per signal; optional timeout arm |
| `waitForExecution(task, id)` | suspends until another execution terminates |
| `switch(id, value, branches)` | persists `{ branchId, result }`; matchers never re-run |
| `workflow(stepId, task, input)` | memoized child start with deterministic idempotency key |
| `emit(event, payload)` | durable event publication |
| `note(message)` | audit-only observability |
| `rollback()` | compensation trigger |

Studio mapping: `step`/`sleep`/`signal`/`switch` become timeline node kinds;
`note` and every transition surface in the audit tab.

## 2. Persisted shapes (what the studio reads)

Steps are append-only facts keyed by `(executionId, stepId)`:

- `step("validateOrder")` → id as declared, result is the return value.
- `sleep(ms, { stepId: "processingDelay" })` → id `__sleep:processingDelay`,
  `{ state: "sleeping", timerId, fireAtMs, durationMs }` →
  `{ state: "completed" }`.
- `waitForSignal(s, { stepId: "awaitAck" })` → id `__signal:awaitAck`,
  `{ state: "waiting", signalId, timeoutMs?, timeoutAtMs?, timerId? }` →
  `{ state: "completed", payload, signalId? }` or `{ state: "timed_out" }`.
- `switch("ackBranch", …)` → id as declared, `{ branchId, result }`.

Without explicit `stepId`, sleeps/signals fall back to call-order ids
(`__sleep:0`, `__signal:<signalId>:<n>`) — a replay footgun on refactor, with
an opt-in `determinism.implicitInternalStepIds: warn|error` guard. The studio
workflows always pass explicit ids.

## 3. Execution lifecycle

`pending → running → sleeping ⇄ running → completed`, with `retrying`,
`cancelling`, `failed`, `cancelled`, `compensation_failed` on the side.
Signals to terminal executions are ignored; cancellation is cooperative
(steps observe an `AbortSignal`).

Studio mapping: status pills + list filters follow these states exactly;
the API returns `409` where the engine would silently ignore an operation.

## 4. Operator surface

- `DurableOperator` (store-backed): list/get executions, direct-child and
  signal-journal queries, step results, audit trail, `retryRollback`,
  `skipStep`, `forceFail`, `editState` (where the store implements them), and
  stuck-execution listing.
- `DurableService`: start/cancel/wait/signal, schedules (cron/interval/
  one-time, pause/resume/update/remove), orphan `recover()`, timer polling.
- `MemoryStore` implements the full operator set including audit persistence
  (once enabled) — the studio relies on all of it.

## 5. Gaps resolved for release/6.6

1. **Attempt-end position preservation.** Suspend, retry, and failure
   transitions now re-read the latest same-attempt execution snapshot so
   `execution.current` survives. Failures also persist `error.stepId`, which
   pinpoints nested failures such as `diagnose` inside `ackBranch`.
2. **Explicit audit default.** Both durable guides now state that
   `audit.enabled` defaults to `false`; the studio enables it deliberately.
3. **Precise no-timeout signal typing.** `waitForSignal()` overloads are keyed
   on `timeoutMs`, so calls without a timeout return only the signal outcome.
4. **Operator discovery surfaces.** `listChildExecutions()` filters by the
   persisted parent identity, while `listSignals()` reads indexed signal
   journals from MemoryStore and RedisStore without a Redis key scan.

Retention/purge and cursor-backed execution indexes remain storage-lifecycle
changes, not UI patches. They should be designed with idempotency-key cleanup,
child orphan rules, timer/waiter removal, and Redis index migration as one
coherent contract.
