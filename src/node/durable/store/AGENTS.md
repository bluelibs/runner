# Durable Persistence Backends

## Scope And Maintenance

These adapters implement `../core/interfaces/store.ts`. Start at that contract:
several methods are atomic commits, not independent writes that happen to be adjacent.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Entry Points And Layout

- `MemoryStore.ts`: facade over instance-owned `memory-store/` operations.
- `PersistentMemoryStore.ts`: adds serialized snapshots and local restart persistence.
- `RedisStore.ts`: facade delegating to `RedisStore.*` operations.
- `RedisStore.runtime.ts`: keys, serialization, shared Redis transport, and client ownership.
- Execution state/views/index modules: writes, idempotency, metadata queries, pagination, and backfill.
- Signal state/waiter modules: journal, FIFO backlog, waiter ordering, and committed delivery.
- Execution waiter modules: dependent workflow completion, including continuation-following waits.
- Continuation/workflow-state modules: successor creation and execution-owned typed state.
- Timer/scheduling modules: bounded claim polling and recurring schedule state.
- `memory-store/runtime.ts`, `shared.ts`, and `snapshot.ts`: maps, cloning, durable mutation hooks, and restoration.
- `memory-store/IndexedExecutions.ts` and `OrderedKeys.ts`: write-through query indexes.

## Persistence Contracts

- Keep exact execution/workflow/step/signal/schedule identities. Backend prefixes are storage namespaces.
- Create execution plus idempotency claim atomically; losing a race returns the existing execution id.
- Status-conditional saves must not overwrite a competing lifecycle transition.
- Continuation commits close the prior run, link the successor, and migrate queued signals together.
- Signal backlog remains FIFO and retains repeated identical signals; history and backlog are different records.
- Completing a waiter must commit the step, remove the waiter, and handle its timeout consistently.
- Claimed timers and locks use owner tokens/leases; stale owners cannot renew or finalize another owner's work.
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
`PersistentMemoryStore.test.ts`, `RedisStore.continuation.mock.test.ts`,
`RedisStore.executionIndex.test.ts`, and signal/waiter/lock suites for the affected record.
Exercise both memory and Redis implementations when changing shared store semantics.
Real Redis suites have explicit infrastructure gates; mocked tests alone do not verify live atomicity.
For code changes run focused tests then root QA; guide-only edits follow the docs exception.
