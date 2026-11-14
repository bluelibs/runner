# Changelog

## 6.9.0 (unreleased)

### Migration

- Prefer `timers` for durable deadline processing; `polling` remains supported as a deprecated alias. Rename `polling.interval` to `timers.pollIntervalMs`; the other option names and defaults are unchanged. Defined `timers` fields override corresponding legacy fields, with omitted values falling back to `polling`, then defaults. Interface documentation now explains sleeps, retries, wait timeouts, schedules, process roles, claim leases, and automatic execution heartbeats.
- Disable and remove the incomplete `DurableContext.emit()` bus-notification feature and its `EmitOptions` type. It did not dispatch Runner hooks or deliver workflow signals. Emit Runner events through injected event dependencies, or deliver workflow signals with `durable.signal(...)`. Historical `emit_published` audit records remain readable.
- RPC lane calls retain **three total attempts by default**. Non-idempotent callers must configure `retry: { maxAttempts: 1 }` explicitly or provide deduplication: a lost response can follow a committed remote effect. Retry budgets, `Retry-After`, and cancellation support remain available. ([#144](https://github.com/bluelibs/runner/pull/144))
- Queued event authentication now defaults to a 24-hour token lifetime. `auth.messageTtlMs` overrides an explicit `auth.tokenTtlMs`, and existing explicit lifetimes remain respected. RPC tokens keep their 60-second default. Retain verification keys across the configured backlog/retry window; longer validity also increases the replay window.
- This minor release does not change existing support commitments for previous major versions.

### Features

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

- Timer configuration migration: `npm run qa` passed with 5,808 tests passed, 59 skipped, zero failures, and 100% instrumented coverage. Preferred and deprecated configurations, field-wise precedence, explicit false values, polling cadence, claim limits, validation, and resource type compatibility are covered; lint, type checks, platform builds, entry points, and consumer bundles passed.
- Continuous recovery and atomic ownership: `npm run qa` passed with 5,794 tests passed, 59 skipped, zero failures, and 100% instrumented coverage. Lint, type checks, all platform builds, standalone entry points, and consumer bundles passed. Separate live Redis takeover/fencing, locking, retention, and cross-worker concurrency checks passed 15 tests across four suites; the dedicated infrastructure workflow now includes the takeover/fencing suite.
- Dependency refresh: `npm run qa` passed with 5,752 source tests passed, 57 skipped, zero failed, and 100% instrumented coverage. All six documentation-generator tests passed, and the generated TypeDoc reflection data is identical before and after switching to patched minimatch. TypeDoc generation, the three durable-workflows example tests, a seven-test browser suite using the upgraded JUnit reporter, package inspection, and focused Handlebars/proxy-addr/qs security checks passed. Production and moderate-or-higher audit gates pass; the raw npm feed still reports the rejected deepmerge CVE noted above.
- After removing the incomplete context emit API and adding stable durable event keys, `npm run qa` passed: 5,758 tests passed, 57 skipped, zero failed; coverage remains 100%. Benchmark-comparison tests, lint/type checks, platform builds, standalone entry points, and consumer bundles passed.
- After restoring the three-attempt RPC default and setting version 6.9.0, `npm run qa` passed: 5,780 tests passed, 29 skipped, zero failed; 810 suites passed, seven skipped. Instrumented coverage is 100%; five benchmark-comparison tests, lint/type checks, all platform builds, standalone entry points, and browser/Node consumer bundles passed. Normal Redis/RabbitMQ integration gates were enabled; separately gated live suites were verified below.
- Separate live checks passed 96 tests across 17 suites with zero skips: Redis history collection and lifecycle races, Redis atomicity, memory/Redis step concurrency, RabbitMQ retry/recovery, overlapping duplicate delivery ownership, and the full Redis resilience test selection.
- Fresh sequential benchmarks against the shipped 6.8.1 source passed all 11 workloads per revision and the unchanged local regression thresholds. Both revisions used identical dependencies, five measured runs, and two warmups; no significant regression was detected.
- The production dependency audit reported zero vulnerabilities.

