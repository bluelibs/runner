# Durable Execution Core

## Scope And Maintenance

Core orchestrates execution through backend contracts. Keep the public facades
readable; state transitions and replay details belong in focused helpers.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Entry Points And Ownership

- `interfaces/` and `types.ts`: public service, context, resource, store, bus, and queue contracts.
- `DurableService.ts`: delegates starts, signals, schedules, recovery, waiting, and lifecycle to managers.
- `DurableResource.ts`: Runner-facing facade and scoped `use()`; `createRunnerDurableRuntime.ts` owns runtime wiring.
- `DurableContext.ts` and `StepBuilder.ts`: workflow-facing replayable actions and compensation.
- `DurableOperator.ts` and `DurableExecutionRepository.ts`: operator queries and workflow-scoped repositories.
- `DurableWorker.ts`: consumes execution messages, tracks in-flight work, and settles deliveries.
- `managers/TaskRegistry.ts`: resolves persistence keys to tasks without losing identity.
- `managers/ExecutionManager.*`: execution transitions, locks, cancellation, pause/resume, restart, and continuation.
- `managers/ExecutionAttemptRunner*`: live attempts, replay outcomes, and recovery redrive.
- `managers/SignalHandler*`, `WaitManager*`: durable delivery and result waiting.
- `managers/PollingManager*`, `ScheduleManager`, `RecoveryManager`: timers, recurrence, and crash recovery.
- `managers/WorkflowAdmissionController.ts`: per-workflow admission ownership.
- `durable-context/`: focused steps, waits, sleep, state, emit, switch, and determinism operations.
- `continuedChain.ts`, `executionWaiters.ts`, `signalWaiters.ts`, `waiterCore.ts`: shared chain/wait bookkeeping.
- `current.ts`, `executionIndex.ts`, `executionCursor.ts`: persisted current activity and query projections.

## Execution Contracts

- Persist the resolved workflow key, not an assumed local task id. Runner wiring resolves canonical ids and tag keys.
- Replay uses stable step ids and persisted results; user ids beginning `__` or `rollback:` are reserved.
- Implicit internal step ids are call-order based; preserve configured determinism warnings/errors.
- Keep durable state mutation, waiter completion, and timer handling consistent with store atomic contracts.
- Continue-as-new links runs and migrates buffered signals atomically; pause/cancel races must win safely.
- Followed execution waits distinguish the requested root from the current continuation tip.
- Pause, shutdown interruption, business failure, and cancellation are distinct outcomes.
  Parking an attempt must not silently consume a retry or turn it into workflow failure.
- Renew and check ownership around long-running work; do not commit after a lease is lost.
- Retain compatibility with optional store methods: unsupported requested features fail clearly.
- Runtime admission, polling timers, cancellation listeners, workers, and async context belong to this service instance.

## Tests And Acceptance

Mirrored tests live in `../../__tests__/durable/core/`: `service/` covers orchestration,
`managers/` covers races and ownership, `durable-context/` covers replay, `lifecycle/`
covers pause/cancel/restart/continuation, and `audit/` covers observability failures.
Use `lifecycle/continueAsNew.signalBacklog.integration.test.ts`,
`managers/ExecutionManager.lock-ownership.unit.test.ts`, and
`managers/WorkflowAdmissionController.ownership.unit.test.ts` as contract examples.
For code changes test the resumed path as well as the first attempt, then run root QA.
