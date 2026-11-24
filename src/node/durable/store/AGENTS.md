# Durable Persistence Backends

## Scope And Maintenance

These adapters implement `../core/interfaces/store.ts`. Start at that contract:
several methods are atomic commits, not independent writes that happen to be adjacent.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Entry Points And Layout

- `RedisStore.retention.ts`, `memory-store/retention.ts`, and `sql/retention.ts` collect due success history (`collectCompletedHistory`) while preserving completion receipts, and expire completion receipts (`collectExpiredReceipts`) when configured. Collection coordinates with execution ownership and waiter results. A missing parent blocks child collection unless the child verified it in the same store at admission. Redis reads per-execution `execution_timers:<id>` (never global `HGETALL durable:timers`) and updates/prunes stale ZSET deadlines so blocked/postponed entries cannot starve later work. SQL retention uses bounded `LIMIT` + `FOR UPDATE SKIP LOCKED`, batched detail deletes, and expired lock sweeps; PostgreSQL uses server `clock_timestamp()` for leases and skips DDL locks when schema objects already exist.
- `MemoryStore.ts`: facade over instance-owned `memory-store/` operations.
- `PersistentMemoryStore.ts`: adds serialized snapshots and local restart persistence.
- `RedisStore.ts`: facade delegating to `RedisStore.*` operations.
- `SqliteStore.ts` & `PostgresStore.ts`: public SQL facades extending `sql/SqlDurableStore.ts` + `sql/SqlDurableStoreBase.ts` over dialect adapters `sql/sqliteBackend.ts` (`node:sqlite`, WAL, serialized `BEGIN IMMEDIATE`) and `sql/postgresBackend.ts` (`pg` pool / `PgPoolLike`, `FOR UPDATE` & `FOR UPDATE SKIP LOCKED`, placeholder rewriting). All SQL tables are namespace-scoped and omit foreign keys on `parent_execution_id` so orphaned child tests remain portable.
- History, commands, and checkpoint modules: monotonic operation metadata, FIFO receipt queues, atomic staged state/result commits, and snapshot-conditional branch creation. Memory history indexes exact step IDs while snapshots retain entry arrays. Repeated history phases skip mutation/persistence. Preserve optional child workflow versions across history reads and branch copies. History/state payloads retain the configured serializer; command receipts survive detail collection.
- `RedisStore.commandTimer.ts` and memory command operations coordinate the FIFO with one shared wakeup and all timer indexes. Admission creates it atomically; final completion removes it. Rescheduling reconciles queue membership without deleting timer claims, so an older delivery cannot erase a new admission.
- `RedisStore.runtime.ts`: keys, serialization, shared Redis transport, and client ownership.
- Execution state/views/index modules: writes, idempotency, metadata queries, pagination, and backfill.
- Signal state/waiter modules: journal, FIFO backlog, waiter ordering, and committed delivery.
- Execution waiter modules: dependent workflow completion, including continuation-following waits.
- Continuation/workflow-state modules: successor creation and execution-owned typed state.
- Timer/scheduling modules: bounded claim polling and recurring schedule state.
- `memory-store/runtime.ts`, `shared.ts`, and `snapshot.ts`: maps, cloning, durable mutation hooks, and restoration.
- `memory-store/IndexedExecutions.ts` and `OrderedKeys.ts`: write-through query indexes.
- `ownership.ts` scopes store calls without bypassing subclass hooks; backend runtimes own separate async-local ownership. `RedisStore.ownership.ts` checks the lease inside each mutation script; memory checks synchronously inside mutation permits.
- `memory-store/IndexedTimers.ts` and `RedisStore.recovery.ts` index pending timers per execution. Redis legacy timers use paged HSCAN backfill; cleanup compares observed payloads so recreated timers keep membership.

## Persistence Contracts

- Keep exact execution/workflow/step/signal/schedule identities. Backend prefixes are storage namespaces.
- Create execution plus idempotency claim atomically; losing a race returns the existing execution id.
- Status-conditional saves must not overwrite a competing lifecycle transition.
- History collection rechecks the current retention deadline after selecting due IDs; the Redis commit then compares the exact record again. A policy extension must win in either race window.
- Continuation commits close the prior run, link the successor, and migrate queued signals together.
- Signal backlog remains FIFO and retains repeated identical signals; history and backlog are different records.
- Completing a waiter must commit the step, remove the waiter, and handle its timeout consistently.
- Claimed timers and locks use owner tokens/leases; stale owners cannot renew or finalize another owner's work.
- PostgreSQL schema creation uses one transaction and a shared advisory lock. Batch timer claims lock timer rows before conditionally inserting or taking over claims in the same transaction. SQL command FIFO/timer writes lock the target execution before queue rows. SQL adapters reuse a bounded cache of prepared SQLite statements and PostgreSQL placeholder rewrites.
- SQLite adapters sharing an injected connection also share its transaction and read serialization.
- Attempt-owned writes must atomically compare the live execution lease before mutation. Never replace this with a read/renew followed by an unguarded write. Optional custom stores without this capability cannot enable continuous recovery.
- Schedule cadence/payload can change, but `ScheduleUpdate` does not permit replacing its id.
- Metadata queries use indexes without scanning payloads; cursors preserve stable ordering.
- Memory state belongs to each instance. Preserve cloning semantics for workflow/signal/execution payloads.
- Persistent memory snapshots are versioned and written through a temporary file plus rename.
  They preserve single-process semantics; do not use a shared file as distributed coordination.
- Snapshot restoration must rebuild indexes and exclude transient ownership from durable restoration.
- Redis stores close owned clients; caller-supplied clients remain caller-owned unless explicitly opted in.
- Preserve serializer behavior, bounded signal queues, and optional-method compatibility.

## Tests And Acceptance

Tests mirror this folder in `../../__tests__/durable/store/`.
Start with `MemoryStore.snapshot.test.ts`, `MemoryStore.continuation.test.ts`,
`PersistentMemoryStore.test.ts`, `SqliteStore.test.ts`, `PostgresStore.test.ts`,
`RedisStore.continuation.mock.test.ts`, `RedisStore.executionIndex.test.ts`,
and signal/waiter/lock/retention suites for the affected record.
Exercise memory, Redis, and SQL implementations when changing shared store semantics.
Real Redis and Postgres suites (`PostgresStore.real.integration.test.ts`) have explicit infrastructure gates; mocked/adapter tests alone do not verify live concurrency.
`RedisStore.retention.real.integration.test.ts` covers operator races, ownership/waiter/parent protection, and collection fairness.
For code changes run focused tests then root QA; guide-only edits follow the docs exception.
