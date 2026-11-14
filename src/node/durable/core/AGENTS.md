# Durable Execution Core

## Scope And Maintenance

Core orchestrates execution through backend contracts. Keep the public facades
readable; state transitions and replay details belong in focused helpers.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Entry Points And Ownership

- `interfaces/` and `types.ts`: public service, context, resource, store, bus, and queue contracts.
- `interfaces/timers.ts` documents deadline processing and process roles. `timerConfig.ts` normalizes preferred `timers` settings with field-wise fallback to deprecated `polling`; `timers.pollIntervalMs` replaces `polling.interval`. Defaults and explicit false values must remain compatible.
- `HistoryCollector.ts` owns lifecycle-bound successful-history collection; `retention.ts` defines admission-time policy and eligibility. `runnerContext.ts` shares one execution stack per Runner Store across durable backends.
- `DurableService.ts`: delegates starts, signals, schedules, recovery, waiting, and lifecycle to managers.
- `DurableResource.ts`: Runner-facing facade and scoped `use()`; `createRunnerDurableRuntime.ts` owns runtime wiring.
- `DurableContext.ts` and `StepBuilder.ts`: workflow-facing replayable actions and compensation.
- `DurableOperator.ts` and `DurableExecutionRepository.ts`: operator queries and workflow-scoped repositories.
- `DurableWorker.ts`: consumes execution messages, tracks in-flight work, and settles deliveries.
- `managers/TaskRegistry.ts`: separates canonical task addressing from workflow storage keys and resolves exact optional workflow versions.
- `managers/CommandManager.ts`, `commandClient.ts`, and `commandContext.ts`: FIFO tracked requests under execution ownership, resumable private state/checkpoints, and atomic result/state commits. State presence distinguishes uninitialized requests from initialized empty state. Commands cannot suspend or start children.
- `durable-context/operationJournal.ts`, `replay.ts`, and `checkpointReset.ts`: ordered metadata for new runs, copied-prefix compatibility checks, and explicit non-overlapping checkpoint branches. `checkpointLease.ts` captures tooling snapshots under the worker lease.
- `managers/ExecutionManager.*`: execution transitions, locks, cancellation, pause/resume, restart, and continuation.
- `managers/ExecutionAttemptRunner*`: live attempts, replay outcomes, and recovery redrive.
- `managers/SignalHandler*`, `WaitManager*`: durable delivery and result waiting. `managers/waitForStoreResult.ts` shares bus notifications, subscription cleanup, deadlines, and store polling between execution and command waits.
- `managers/PollingManager*`, `ScheduleManager`, `RecoveryManager`: timers, recurrence, and crash recovery.
- `managers/ClusterRecovery.ts` owns opt-in bounded continuous metadata sweeps; `clusterRecoveryEligibility.ts` distinguishes orphaned progress from healthy parked waits. Recovery dispatch claims are separate from execution leases.
- `managers/WorkflowAdmissionController.ts`: workflow admission; `StoreAdmissionController.ts` shares store-backed policies with `StepAdmissionController.ts`. Renewal and cancellable acquisition reuse Node resilience helpers.
- `durable-context/`: focused steps, waits, sleep, state, switch, and determinism operations. Runner events use injected dependencies; the incomplete context bus-emission API is removed.
- `continuedChain.ts`, `executionWaiters.ts`, `signalWaiters.ts`, `waiterCore.ts`: shared chain/wait bookkeeping.
- `current.ts`, `executionIndex.ts`, `executionCursor.ts`: persisted current activity and query projections.

## Execution Contracts

- Persist the resolved workflow key, not an assumed local task id. Runner wiring resolves canonical ids and tag keys.
- Replay uses stable step ids and persisted results; user ids beginning `__` or `rollback:` are reserved.
- Implicit internal step ids are call-order based; preserve configured determinism warnings/errors.
- Keep durable state mutation, waiter completion, and timer handling consistent with store atomic contracts.
- Continue-as-new links runs and migrates buffered signals atomically; pause/cancel races must win safely.
- Followed execution waits distinguish the requested root from the current continuation tip.
- Persisted compensation failures notify execution waiters, including queued parents. Error text alone must not park an unrelated business failure.
- Pause, shutdown interruption, business failure, and cancellation are distinct outcomes.
  Parking an attempt must not silently consume a retry or turn it into workflow failure.
- Step saturation saves a retry timer and releases workflow admission; interrupted callbacks stop renewal and retain numeric capacity until settlement or lease expiry, including execution-lock loss.
- `durable-context/DurableContext.stepAttempt.ts` journals step retry consumption by workflow attempt so concurrency replay preserves its budget. Obsolete fixed-window grants defer, and callback entry checks expiry synchronously before user code.
- Renew and check ownership around long-running work; do not commit after a lease is lost.
- `ExecutionAttemptRunner` passes an execution-owned store through async-local attempt scope; built-in stores atomically fence mutations. Root lease acquisition/heartbeat, operator calls, and external signal delivery remain independent. Continuous recovery requires ownership plus indexed metadata/timer inspection and renewable locks.
- New executions record separate ordered operation metadata when supported; legacy executions do not fabricate missing history. Reset/export require source ownership, and reset only cuts a completed, non-overlapping prefix.
- Explicit versions are pinned across resume/restart/timers/signals; continue-as-new retains the version unless it requests an upgrade. Unversioned addressing remains unchanged.
- Command admission and successful completion/continuation are coordinated atomically: a pending command prevents the target from closing successfully before its FIFO is drained. Pauses retain staged requests; terminal notification rejects them.
- Command admission persists one shared `commandWakeup.ts` timer with the FIFO. Completion removes it only when the FIFO empties; polling reschedules and releases claims rather than finalizing this timer. New arrivals during an attempt's final FIFO check are redriven after execution lease release; parked heads retain delayed recovery.
- Repeated history phases are storage no-ops. Replay advances a cursor and skips cached descendants through a parent index, including interleaved parallel operations.
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
