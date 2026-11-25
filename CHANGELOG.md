# Changelog

## 6.10.0 - 2026-11-25 - "The Durable Dopamine Release"

Workflows that survive crashes, stores that speak SQL, and a framework that got noticeably leaner. Highlights: SQLite and PostgreSQL durable stores, receipt retention, workflow commands/versioning/replay tooling, cluster recovery, durable events, and a faster hot path.

### Features

- Add built-in SQL durable persistence backends and Runner resources:
  - `SqliteStore` and `resources.sqliteWorkflow` (`sqliteDurableResource`) built on Node >= 22's native `node:sqlite` (`DatabaseSync`), using WAL mode for file databases, busy timeouts, and serialized immediate transactions for single-node local persistence.
  - `PostgresStore` and `resources.postgresWorkflow` (`postgresDurableResource`) built on optional `pg` (or any structural `PgPoolLike`), using row-level `FOR UPDATE` fencing, `FOR UPDATE SKIP LOCKED` timer claiming, and namespace-scoped schemas for multi-worker deployments. When `redis` is omitted on `postgresWorkflow`, event notifications fall back to `MemoryEventBus`.
- Add optional two-stage durable receipt expiry via `retention.receipts` (`"retain" | "delete" | { afterMs }`) and `IDurableStore.collectExpiredReceipts(now, limit)` across Memory, PersistentMemory, Redis, SQLite, and PostgreSQL stores. Validates at tag/resource/service admission that `receipts` cannot expire earlier than `onComplete`, while permitting one-stage full cleanup (`{ onComplete: "retain", receipts: { afterMs } }`) and atomically releasing idempotency keys, command receipts, execution indexes, timers, and dependent execution records.
- Add a PostgreSQL 17 integration test suite and service container to `.github/workflows/real-infrastructure.yml`.

### Performance

Runner got fast. Measured against `main` before [#164](https://github.com/bluelibs/runner/pull/164) (Apple M1 Max, Node 24.11, medians of six fresh processes per revision, alternating run order):

| Workload | Before | After | Change |
| --- | ---: | ---: | ---: |
| Basic task via `runTask()` | 367,198 tasks/s | 964,692 tasks/s | **2.63x** |
| Task with five middleware layers | 119,132 tasks/s | 285,648 tasks/s | **2.40x** |
| Task emitting one event with one hook | 126,180 events/s | 265,934 events/s | **2.11x** |
| Cache hit | 5.11 µs | 2.59 µs | 49% less time |
| 5,000 task calls without execution context | 14.72 ms | 5.88 ms | 60% less time |
| Serializer `stringify` + `parse`, 1 KB JSON | 40,109 round trips/s | 86,619 round trips/s | **2.16x** |
| In-memory SQLite, claim 1,024 due timers | 16.80 ms | 5.50 ms | 67% less time |
| MemoryStore renewals with 1,024 live locks | 183,606/s | 2,785,065/s | **15.17x** |

The gains come from reusing runtime context and middleware work, fewer allocations in serializer and validation paths, batched SQL timer claims with prepared-statement reuse, signed-JSON reuse across remote calls and retries, and cheaper cache eviction and invalidation. Cache misses, resource initialization, and parallel runtime lifecycle are at parity. These numbers measure local Runner overhead; application-level gains depend on how much time you spend in these paths. Public behavior is unchanged.

### Internal

- Split the core `Store`, `DependencyProcessor`, `Match` engine, HTTP smart client, `DependencyExtractor`, and `ExecutionContextStore` into focused modules and dedupe shared helpers ([#162](https://github.com/bluelibs/runner/pull/162), [#163](https://github.com/bluelibs/runner/pull/163)). Public exports are unchanged.

### Fixes

- Fix HTTP smart client request lifetimes: build requests synchronously when no hook is configured, observe raw upload source errors before awaiting hooks, and keep multipart timeouts active until the request closes.
- Fit SQLite timer claim batches within the 999-variable bind budget and encode fallback JSON after the configured request hook.
- Deploy documentation from a dedicated CI job with serialized concurrency, removing the racy Pages artifact cleanup that intermittently failed `main`.
- Revalidate source execution ownership before returning replay fixtures in `withCheckpointLease`, release acquired step-concurrency permits if `createStepProgress` initialization fails, and verify candidate workflow version before falling back to `externalResolver` in `TaskRegistry.find()`.
- Serialize PostgreSQL schema startup, first signal writes, and command FIFO wakeups. Preserve exclusive ownership during contested PostgreSQL lease and timer claims and serialize stores that share a SQLite connection.
- Let a same-backend child's history and receipt expire after its verified parent's receipt expires. Reject a mismatched starting version in typed child execution waits.
- Hoist compiled `Match` validators above `RedisResilience` instance methods instead of recompiling patterns on every Redis script reply.
- Use a valid non-dotted task ID (`r.task("greet")`) in the `r` entry point JSDoc example (`src/public.ts`).

### Operational limits

- `PostgresStore` requires installing optional dependency `pg` or passing a compatible `PgPoolLike` adapter. `SqliteStore` requires Node >= 22 with `node:sqlite`.
- Expiring an execution's receipt removes its completion record and idempotency mapping so subsequent starts with the same idempotency key create a new execution. Failures, cancellations, and executions with missing/incomplete parents, active locks, queued commands, or active waiters remain retained.

## 6.9.0 (unreleased)

### Migration

- Deprecate only the task-definition overload `d.step(id, taskDefinition, input, options)`. It remains fully typed and operational without runtime warnings. Prefer an injected task dependency inside the callback overload, forwarding its cancellation signal and downstream idempotency key explicitly. Existing callback and compensation-builder forms remain current; task-identity metadata is retained for deprecated calls, so preserve existing workflow versions when migrating recorded replay fixtures.

- The workflow capability APIs in this change are additive. Existing step forms, retry defaults/counts, exported `DurableStepRunContext`, unversioned workflows, test setup helpers, and version-1 memory snapshots remain supported. New custom-store/service capabilities are optional; commands and checkpoint tooling fail clearly when explicitly requested on unsupported adapters. Keep older workflow implementations and timer workers available when adopting explicit versions or tracked commands.

- Prefer `timers` for durable deadline processing; `polling` remains supported as a deprecated alias. Rename `polling.interval` to `timers.pollIntervalMs`; the other option names and defaults are unchanged. Defined `timers` fields override corresponding legacy fields, with omitted values falling back to `polling`, then defaults. Interface documentation now explains sleeps, retries, wait timeouts, schedules, process roles, claim leases, and automatic execution heartbeats.
- Disable and remove the incomplete `DurableContext.emit()` bus-notification feature and its `EmitOptions` type. It did not dispatch Runner hooks or deliver workflow signals. Emit Runner events through injected event dependencies, or deliver workflow signals with `durable.signal(...)`. Historical `emit_published` audit records remain readable.
- RPC lane calls retain **three total attempts by default**. Non-idempotent callers must configure `retry: { maxAttempts: 1 }` explicitly or provide deduplication: a lost response can follow a committed remote effect. Retry budgets, `Retry-After`, and cancellation support remain available. ([#144](https://github.com/bluelibs/runner/pull/144))
- Queued event authentication now defaults to a 24-hour token lifetime. `auth.messageTtlMs` overrides an explicit `auth.tokenTtlMs`, and existing explicit lifetimes remain respected. RPC tokens keep their 60-second default. Retain verification keys across the configured backlog/retry window; longer validity also increases the replay window.
- This minor release does not change existing support commitments for previous major versions.

### Features

- Add stable downstream idempotency keys, resumable progress heartbeats, and optional `durable.useStep()` integration. Ordinary injected tasks can run inside callback steps; the typed task-definition overload remains available as deprecated compatibility support. Existing retries remain available with the same additional-attempt count; all retrying steps now preserve their consumed budget and remaining backoff across interruptions within a workflow attempt.
- Add optional workflow implementation versions, pinned through recovery, restart, signals, timers, and schedules. Continue-as-new retains its version unless an explicit upgrade is requested; missing explicit versions wait for a capable worker. Existing unversioned workflows retain their routing.
- Add declared, typed workflow commands using ordinary Runner tasks. Requests serialize under execution ownership, stage state privately, and atomically commit state with their durable result receipt. Request keys deduplicate retries; caller wait deadlines leave accepted requests durable.
- Add ordered operation history for newly admitted executions, structural replay compatibility checks, and a Runner-backed test runtime with explicit virtual workflow timers and settled-worker restart. Add operator checkpoint reset as a new execution branch, with an atomic completed-prefix/state copy and source lineage. Legacy or collected histories cannot be reconstructed; overlapping and unfinished boundaries fail explicitly.
- Simplify workflow capabilities: unchanged history phases skip writes, memory history uses step-ID indexes without changing snapshot format, and replay uses a cursor with indexed descendants. Commands use one atomically persisted wakeup per execution, preserve new admissions during timer delivery, infer staged-state initialization from its presence, and share execution waiting's bus notifications and polling fallback. Commands arriving during the final FIFO check are redriven after lease release.
- Keep workflow progress parked while the head command waits for a step permit. Poll for committed receipts even when the event bus subscription stalls. Preserve due one-shot and recurring occurrences when a timer worker lacks their pinned implementation. Reserve distinct checkpoint IDs for parallel waits and validate pinned child workflow versions during replay.

- Add opt-in continuous cluster recovery with `recovery.enabled`, bounded metadata pages, per-worker concurrency, recovery dispatch claims, and lifecycle shutdown handling. Built-in stores atomically fence attempt mutations against the execution lease; abandoned workflows resume from saved checkpoints without worker restarts. Recovery skips healthy waits and repairs missing wait timers or lost wakeups. Custom stores require explicit ownership/index capabilities; existing manual/startup recovery remains available.
- Add optional `tags.durableEvent.with({ key })` persistence identities for event renames and resource moves. Stable keys preserve event recovery, parent-child submission checkpoints, and per-emission deduplication. Without a key, canonical-id addressing remains unchanged; existing saved hook and backend identities must remain compatible.
- Add durable event dispatch through ordinary event emission APIs, with persisted ordered hook membership, recoverable compensation, parent linkage, and replay deduplication. Existing executions retain their saved hook order while using current implementations. ([#149](https://github.com/bluelibs/runner/pull/149))
- Add immediate or delayed successful-workflow history collection for memory, file-persisted memory, and Redis stores. Configure `retention.onComplete` and the background `garbageCollection` interval/batch size; policy resolves when each execution is admitted. Completion results, receipts, and idempotency mappings remain available to late waiters and parent replay. ([#149](https://github.com/bluelibs/runner/pull/149))
- Add `StepOptions.concurrency` for numeric, named shared, and fixed-window callback-start limits across durable workers. Saturation suspends the attempt and releases workflow admission; lease ownership and callback retry budgets survive interruption and replay. ([#145](https://github.com/bluelibs/runner/pull/145))
- Add optional RPC retry deadlines through `retry.totalTimeoutMs`, honor `Retry-After`, and support queued event token lifetimes through `auth.messageTtlMs`. The RPC default remains three total attempts. ([#144](https://github.com/bluelibs/runner/pull/144))

### Fixes

- Preserve RabbitMQ delivery ownership across retries, overlapping logical duplicates, reconnects, publisher confirmation, and channel backpressure. Buffered JSON and multipart requests share timeout and cancellation handling. ([#144](https://github.com/bluelibs/runner/pull/144))
- Update the locked cron-parser dependency to 5.10.3. ([#150](https://github.com/bluelibs/runner/pull/150))
- Update development dependencies, use patched esbuild/glob/matcher versions across compatible tooling, and upgrade the CI JUnit reporter. Rebuild the durable-workflows example lockfile without stale copies of root development dependencies.
- Generate API documentation through TypeDoc's public conversion API, allowing patched minimatch 11 throughout the development dependency tree without changing documentation entry points or compiler/validation checks.
- Include real Redis retention races and RabbitMQ duplicate-delivery ownership in the dedicated infrastructure workflow.

### Operational limits

- Continuous recovery requires upgraded writers and completed execution-index backfill on existing Redis deployments; the per-execution timer index backfills lazily with paged `HSCAN`. Failover includes the 30-second execution lease, sweep traversal, and queue delivery. Redis is the shared multi-process backend; file-persisted memory remains single-process. Fencing protects stored progress, while external effects still require idempotency or reconciliation. No release is published by this change.
- npm still reports GHSA-gcqx-w48m-w2h4 for Jest's `deepmerge`, although [CVE-2026-93753 was rejected on November 2, 2026 because it does not describe a security vulnerability](https://raw.githubusercontent.com/CVEProject/cvelistV5/main/cves/2026/93xxx/CVE-2026-93753.json). Jest is on the current 30.5.2 release; no merge-library fork or downgrade is needed for that rejected finding.
- History collection removes successful details, not all storage. Completion receipts, results, and deduplication mappings remain indefinitely; receipt expiry is not implemented. Failed/cancelled executions and continuation predecessors retain history. Children with an unverifiable cross-backend parent also retain history.
- Redis collection enumerates timer metadata once per batch. The default collector processes up to 100 executions per minute; larger sustained workloads require tuning and capacity verification. No million-execution load result is claimed.
- The first durable event bridge supports sequential named exact-event hooks. Global/selector hooks, competing remote routes, hook-owned waits, and nested durable emission from hook bodies fail explicitly. External effects still require downstream idempotency or reconciliation.

### Verification

- Durable workflow capabilities, simplification, and task-overload deprecation: `npm run qa` passed with 5,902 tests passed, 65 tests skipped, zero failures, and 100% instrumented coverage. Legacy context/builder, adapter, and timer-type contracts, lint/type checks, platform builds, entry points, consumer bundles, benchmark-comparison tests, and documentation-generator tests passed. The recommended injected-task callback pattern preserves cancellation, downstream keys, restart replay, and standalone task calls. Language-service checks mark only task-definition calls deprecated on concrete and interface context types. Separate live Redis checks passed 13 tests across four suites, including cross-client serialization, command fencing/state receipts, shared-wakeup delivery races, unchanged-history write checks, checkpoint branches with pinned child metadata, takeover, and retention. The npm tarball includes the new declarations and materialized skill references; no release was published.

- Timer configuration migration: `npm run qa` passed with 5,808 tests passed, 59 skipped, zero failures, and 100% instrumented coverage. Preferred and deprecated configurations, field-wise precedence, explicit false values, polling cadence, claim limits, validation, and resource type compatibility are covered; lint, type checks, platform builds, entry points, and consumer bundles passed.
- Continuous recovery and atomic ownership: `npm run qa` passed with 5,794 tests passed, 59 skipped, zero failures, and 100% instrumented coverage. Lint, type checks, all platform builds, standalone entry points, and consumer bundles passed. Separate live Redis takeover/fencing, locking, retention, and cross-worker concurrency checks passed 15 tests across four suites; the dedicated infrastructure workflow now includes the takeover/fencing suite.
- Dependency refresh: `npm run qa` passed with 5,752 source tests passed, 57 skipped, zero failed, and 100% instrumented coverage. All six documentation-generator tests passed, and the generated TypeDoc reflection data is identical before and after switching to patched minimatch. TypeDoc generation, the three durable-workflows example tests, a seven-test browser suite using the upgraded JUnit reporter, package inspection, and focused Handlebars/proxy-addr/qs security checks passed. Production and moderate-or-higher audit gates pass; the raw npm feed still reports the rejected deepmerge CVE noted above.
- After removing the incomplete context emit API and adding stable durable event keys, `npm run qa` passed: 5,758 tests passed, 57 skipped, zero failed; coverage remains 100%. Benchmark-comparison tests, lint/type checks, platform builds, standalone entry points, and consumer bundles passed.
- After restoring the three-attempt RPC default and setting version 6.9.0, `npm run qa` passed: 5,780 tests passed, 29 skipped, zero failed; 810 suites passed, seven skipped. Instrumented coverage is 100%; five benchmark-comparison tests, lint/type checks, all platform builds, standalone entry points, and browser/Node consumer bundles passed. Normal Redis/RabbitMQ integration gates were enabled; separately gated live suites were verified below.
- Separate live checks passed 96 tests across 17 suites with zero skips: Redis history collection and lifecycle races, Redis atomicity, memory/Redis step concurrency, RabbitMQ retry/recovery, overlapping duplicate delivery ownership, and the full Redis resilience test selection.
- Fresh sequential benchmarks against the shipped 6.8.1 source passed all 11 workloads per revision and the unchanged local regression thresholds. Both revisions used identical dependencies, five measured runs, and two warmups; no significant regression was detected.
- The production dependency audit reported zero vulnerabilities.
