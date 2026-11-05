# Changelog

## 6.9.0 (unreleased)

### Migration

- RPC lane calls retain **three total attempts by default**. Non-idempotent callers must configure `retry: { maxAttempts: 1 }` explicitly or provide deduplication: a lost response can follow a committed remote effect. Retry budgets, `Retry-After`, and cancellation support remain available. ([#144](https://github.com/bluelibs/runner/pull/144))
- Queued event authentication now defaults to a 24-hour token lifetime. `auth.messageTtlMs` overrides an explicit `auth.tokenTtlMs`, and existing explicit lifetimes remain respected. RPC tokens keep their 60-second default. Retain verification keys across the configured backlog/retry window; longer validity also increases the replay window.
- This minor release does not change existing support commitments for previous major versions.

### Features

- Add durable event dispatch through ordinary event emission APIs, with persisted ordered hook membership, recoverable compensation, parent linkage, and replay deduplication. Existing executions retain their saved hook order while using current implementations. ([#149](https://github.com/bluelibs/runner/pull/149))
- Add immediate or delayed successful-workflow history collection for memory, file-persisted memory, and Redis stores. Configure `retention.onComplete` and the background `garbageCollection` interval/batch size; policy resolves when each execution is admitted. Completion results, receipts, and idempotency mappings remain available to late waiters and parent replay. ([#149](https://github.com/bluelibs/runner/pull/149))
- Add `StepOptions.concurrency` for numeric, named shared, and fixed-window callback-start limits across durable workers. Saturation suspends the attempt and releases workflow admission; lease ownership and callback retry budgets survive interruption and replay. ([#145](https://github.com/bluelibs/runner/pull/145))
- Add optional RPC retry deadlines through `retry.totalTimeoutMs`, honor `Retry-After`, and support queued event token lifetimes through `auth.messageTtlMs`. The RPC default remains three total attempts. ([#144](https://github.com/bluelibs/runner/pull/144))

### Fixes

- Preserve RabbitMQ delivery ownership across retries, overlapping logical duplicates, reconnects, publisher confirmation, and channel backpressure. Buffered JSON and multipart requests share timeout and cancellation handling. ([#144](https://github.com/bluelibs/runner/pull/144))
- Update the locked cron-parser dependency to 5.10.3. ([#150](https://github.com/bluelibs/runner/pull/150))
- Update development dependencies, use patched esbuild/glob/matcher versions across compatible tooling, and upgrade the CI JUnit reporter. Rebuild the durable-workflows example lockfile without stale copies of root development dependencies.
- Include real Redis retention races and RabbitMQ duplicate-delivery ownership in the dedicated infrastructure workflow.

### Operational limits

- Two development dependency advisories remain: Jest's `deepmerge` has no patched release (GHSA-gcqx-w48m-w2h4), and TypeDoc still needs `minimatch` 10 because version 11 removes its required `matchOne` API (GHSA-g3hv-75wg-m249). Other matcher consumers use version 11; production dependencies are unaffected by these two advisories.
- History collection removes successful details, not all storage. Completion receipts, results, and deduplication mappings remain indefinitely; receipt expiry is not implemented. Failed/cancelled executions and continuation predecessors retain history. Children with an unverifiable cross-backend parent also retain history.
- Redis collection enumerates timer metadata once per batch. The default collector processes up to 100 executions per minute; larger sustained workloads require tuning and capacity verification. No million-execution load result is claimed.
- The first durable event bridge supports sequential named exact-event hooks. Global/selector hooks, competing remote routes, hook-owned waits, and nested durable emission from hook bodies fail explicitly. External effects still require downstream idempotency or reconciliation.

### Verification

- Dependency refresh: `npm run qa` passed with 5,752 tests passed, 57 skipped, zero failed, and 100% instrumented coverage. TypeDoc generation, the three durable-workflows example tests, a seven-test browser suite using the upgraded JUnit reporter, package inspection, and focused Handlebars/proxy-addr/qs security checks passed. The production audit is clean; full audits retain only the two development advisories noted above.
- After restoring the three-attempt RPC default and setting version 6.9.0, `npm run qa` passed: 5,780 tests passed, 29 skipped, zero failed; 810 suites passed, seven skipped. Instrumented coverage is 100%; five benchmark-comparison tests, lint/type checks, all platform builds, standalone entry points, and browser/Node consumer bundles passed. Normal Redis/RabbitMQ integration gates were enabled; separately gated live suites were verified below.
- Separate live checks passed 96 tests across 17 suites with zero skips: Redis history collection and lifecycle races, Redis atomicity, memory/Redis step concurrency, RabbitMQ retry/recovery, overlapping duplicate delivery ownership, and the full Redis resilience test selection.
- Fresh sequential benchmarks against the shipped 6.8.1 source passed all 11 workloads per revision and the unchanged local regression thresholds. Both revisions used identical dependencies, five measured runs, and two warmups; no significant regression was detected.
- The production dependency audit reported zero vulnerabilities.

