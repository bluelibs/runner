# Runner 6.3 Release Notes

## Highlights

Runner 6.3 introduces **external abort signal integration** for runtime
lifecycle control, **forced disposal escalation** that escapes stuck graceful
shutdowns, **selector-based hook targets** that subscribe to entire resource
subtrees or predicate-matched events at bootstrap time, and **semantic cache
invalidation via refs** that enables cross-task cache purging by domain
identity.

This release also ships a major internal decomposition of `run()` into focused
modules — the new `RunShutdownController`, `RunDisposalSignal`,
`ForceDisposalController`, and `normalizeRunOptions` utilities keep shutdown
orchestration out of the main entrypoint — extracts `StoreRegistry` from
`Store` for cleaner separation of concerns, adds cooperative shutdown guards
throughout ready and cooldown waves, tightens `isOneOf()` to only match
definition-identity emissions, names the two internal framework namespace
resources (`system` and `runner`), and moves test-only active-runtime cleanup
into a dedicated module.

High-level takeaways:

- Pass an external `AbortSignal` to `run()` to cancel bootstrap or trigger
  graceful disposal without polluting ambient execution context signals.
- Call `runtime.dispose({ force: true })` to skip remaining graceful phases and
  jump directly to resource disposal.
- Hook `.on(...)` now accepts `subtreeOf(resource)`, predicate functions, and
  mixed arrays alongside exact event references.
- Cache key builders can return `{ cacheKey, refs }` and call
  `cacheResource.invalidateRefs(...)` to purge entries by semantic identity.
- The `isOneOf()` event guard now requires definition identity — arbitrary
  `{ id }`-shaped objects no longer match.
- Bootstrap phases are now interruptible: shutdown requested mid-startup
  cooperatively stops remaining ready waves.
- Internal framework resources (`system`, `runner`) now carry metadata for
  tooling and documentation.

---

## New Features

### External Abort Signal for Runtime Lifecycle

`run()` now accepts an optional `signal` parameter that bridges an external
`AbortSignal` into the runtime shutdown lifecycle. This signal is intentionally
separate from ambient execution context signals — it controls only the runtime
lifecycle boundary.

```ts
const controller = new AbortController();
const runtime = await run(app, {
  signal: controller.signal,
  shutdownHooks: false, // typical when an outer host owns shutdown
});

// Later: trigger graceful disposal from outside
controller.abort();
```

Behaviour by lifecycle phase:

| Phase                    | Effect of signal abort                                  |
| ------------------------ | ------------------------------------------------------- |
| Before readiness         | Cancels bootstrap; rolls back any initialized resources |
| After readiness          | Starts graceful disposal (same as `runtime.dispose()`)  |
| Bootstrap already failed | No-op — startup already owns rollback                   |

Key details:

- The signal listener is cleaned up as soon as the runtime finishes tearing
  down, preventing memory leaks from long-lived signals.
- The signal does not feed into `asyncContexts.execution` or task-level abort
  propagation. It only governs the `run()` lifecycle boundary.
- Combine with `shutdownHooks: false` when an external orchestrator (Lambda
  runtime, container mesh, job scheduler) owns the shutdown trigger.

---

### Forced Disposal Escalation

`runtime.dispose()` now accepts an optional `{ force: true }` parameter that
escalates from graceful shutdown to immediate resource disposal.

```ts
// Normal graceful shutdown (unchanged)
await runtime.dispose();

// Force: skip remaining graceful phases
await runtime.dispose({ force: true });
```

When `force: true` is used, Runner:

- Skips `cooldown()` hooks if they haven't started yet
- Skips `dispose.cooldownWindowMs` wait
- Skips `events.disposing` emission if not yet fired
- Skips the drain wait
- Skips `events.drained` emission if not yet fired
- Jumps directly to resource `dispose()` in reverse dependency order

Important: force disposal does not preempt lifecycle work already in flight. If
`cooldown()` is mid-execution, it completes before disposal proceeds. The
escalation only skips phases that have not started yet.

Once force disposal is requested, any new business calls (`runTask`,
`emitEvent`, `getResourceValue`, etc.) are immediately rejected with the typed
`shutdownLockdownError` instead of being admitted into the cooling-down
runtime. This prevents new work from sneaking in while the remaining graceful
phases are being skipped.

The `ForceDisposalController` coordinates internally via a promise-based signal
that the shutdown disposal lifecycle checks at each phase boundary.

New type:

```ts
type RuntimeDisposeOptions = {
  force?: boolean;
};
```

---

### Selector-Based Hook Targets

Hooks can now subscribe to events using flexible selectors in addition to exact
event references. Selectors resolve once at bootstrap against the registered
event set and respect visibility rules on the `listening` channel.

```ts
import { r, subtreeOf } from "@bluelibs/runner";

// Subscribe to all visible events in a resource subtree
const auditHook = r
  .hook("audit")
  .on(subtreeOf(featureResource))
  .run(async (event) => {
    console.log("Audit:", event.id, event.data);
  })
  .build();

// Subscribe via predicate
const taggedHook = r
  .hook("taggedOnly")
  .on((event) => myTag.exists(event))
  .run(async (event) => {
    // Runs for every registered event matching the predicate
  })
  .build();

// Mix exact refs, subtreeOf, and predicates in arrays
const mixedHook = r
  .hook("mixed")
  .on([exactEvent, subtreeOf(otherResource), (e) => e.id.startsWith("billing")])
  .run(async (event) => {
    // Runs for all matched events
  })
  .build();

// Filter subtreeOf to events only (excludes hooks)
const eventsOnly = r
  .hook("eventsOnly")
  .on(subtreeOf(resource, { types: ["event"] }))
  .run(async () => {})
  .build();
```

Selector rules:

- Selectors resolve once during bootstrap against canonical registered event
  definitions.
- Selector matches are narrowed to events the hook may listen to on the
  `listening` visibility channel.
- Exact direct event refs still fail fast when visibility is violated.
- Selector matches that are not visible are silently skipped.
- Arrays may mix exact events, `subtreeOf(...)`, and predicates, but `"*"` must
  remain standalone and cannot appear inside arrays.
- Selector-based hooks intentionally lose payload autocomplete because the final
  matched set is runtime-resolved. Exact event refs and `onAnyOf(...)` keep the
  usual strong payload inference.

New types exported:

| Type                 | Description                                                |
| -------------------- | ---------------------------------------------------------- |
| `HookOnPredicate`    | `(event: IEvent<any>) => boolean` — predicate for matching |
| `HookSelectorTarget` | `IsolationSubtreeFilter \| HookOnPredicate`                |
| `HookArrayOnTarget`  | `IEventDefinition<any> \| HookSelectorTarget`              |

---

### Semantic Cache Invalidation via Refs

Cache key builders can now return structured descriptors that attach semantic
refs to cached entries. These refs enable cross-task invalidation without
manual key tracking.

```ts
const getUserTask = r
  .task("getUser")
  .middleware([
    cacheMiddleware.with({
      ttl: 60_000,
      keyBuilder: (taskId, input) => ({
        cacheKey: `user-${input.id}`,
        refs: [`user:${input.id}`, `org:${input.orgId}`],
      }),
    }),
  ])
  .run(async (input) => fetchUser(input.id))
  .build();
```

Invalidate by ref:

```ts
const cache = runtime.getResourceValue(cacheResource);

// Delete all entries linked to "user:123" across all task caches
const deletedCount = await cache.invalidateRefs("user:123");

// Or multiple refs at once
await cache.invalidateRefs(["user:123", "org:456"]);
```

Key details:

- `keyBuilder` may return a plain `string` (unchanged) or
  `{ cacheKey: string, refs?: CacheRef[] }`.
- Refs are indexed alongside cache entries and scoped by tenant when
  `tenantScope` is active.
- `invalidateRefs()` returns the count of deleted entries.
- The feature works with both the built-in in-memory provider and the Redis
  cache provider.

New types exported:

| Type                    | Description                                        |
| ----------------------- | -------------------------------------------------- |
| `CacheRef`              | `string` — semantic ref identifier                 |
| `CacheKeyDescriptor`    | `{ cacheKey: string, refs?: readonly CacheRef[] }` |
| `CacheKeyBuilderResult` | `string \| CacheKeyDescriptor`                     |
| `CacheEntryMetadata`    | `{ refs?: readonly CacheRef[] }`                   |

---

### Framework Namespace Resources

Runner now creates two named framework namespace resources below the internal
synthetic framework root:

| Id       | Contents                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `system` | Locked internals: `resources.store`, `resources.eventManager`, `resources.taskRunner`, `resources.middlewareManager`, `resources.runtime`, lifecycle events, internal system tag           |
| `runner` | Built-in utility globals: `resources.mode`, `resources.health`, `resources.timers`, `resources.logger`, `resources.serializer`, `resources.queue`, core tags, middleware, framework errors |

Both carry `.meta.title` and `.meta.description` for documentation and tooling,
even though the transparent `runtime-framework-root` stays internal-only.

---

### Tag Dependencies: `tag.startup()` Accessor

Use `tag.startup()` when a tag dependency accessor must resolve earlier during
bootstrap, while Runner is still building the startup dependency tree.

```ts
const warmup = r.tag("warmup").for(["tasks"]).build();

const boot = r
  .resource("boot")
  .dependencies({
    runtimeWarmups: warmup, // resolves in the normal dependency graph
    startupWarmups: warmup.startup(), // resolves earlier, during bootstrap
  })
  .build();
```

---

## Behavioural Changes

### `isOneOf()` Now Requires Definition Identity

**Previously:** `isOneOf()` checked definition identity first, then fell back to
`id`-based string matching for objects without Runner's internal identity
marker.

**Now:** `isOneOf()` only checks definition identity via `isSameDefinition()`.
Arbitrary `{ id }`-shaped objects that are not actual Runner definitions no
longer match.

```ts
// Before: this could match if the ids happened to align
isOneOf(arbitraryObject, [myEvent]); // might return true

// After: only true Runner definitions with internal identity marks match
isOneOf(emission, [myEvent]); // true only for real emissions
```

**Fix:** ensure you're comparing actual Runner event emissions, not plain
objects with an `id` field.

---

### Bootstrap Phases Are Now Interruptible

**Previously:** once bootstrap started, ready waves ran to completion even if a
shutdown signal arrived mid-startup.

**Now:** every bootstrap phase checks for shutdown requests between waves.
Specifically:

- Each ready wave checks `shouldStop()` before proceeding.
- Each cooldown wave checks `shouldStop()` before proceeding.
- Parallel ready waves check before launching each resource.
- The `events.ready` emission runs inside a phase signal scope that can be
  interrupted.

This means a `SIGTERM` or `signal.abort()` arriving during a long multi-wave
startup sequence will stop at the next wave boundary rather than running all
remaining waves first.

---

### `Store.ready()` Accepts Cooperative Shutdown Guard

`Store.ready()` and `Store.cooldown()` now accept optional cooperative guards:

```ts
// Internal usage — not part of the public API
await store.ready({ shouldStop: throwIfShutdownRequested });
await store.cooldown({ shouldStop: () => forceDisposal.isRequested });
```

This is an internal contract used by `RunShutdownController` and is not
intended for direct consumer use.

---

## Internal Refactors

### `run.ts` Decomposition

The monolithic `run()` function has been decomposed into focused modules:

| New Module                         | Responsibility                                                  |
| ---------------------------------- | --------------------------------------------------------------- |
| `runShutdownController.ts`         | Bootstrap-aware shutdown wiring for a single `run()` invocation |
| `runDisposalSignal.ts`             | Bridges external `AbortSignal` into runtime shutdown lifecycle  |
| `ForceDisposalController.ts`       | Promise-based signal for forced disposal escalation             |
| `normalizeRunOptions.ts`           | Centralised `RunOptions` normalisation with defaults            |
| `assertExecutionContextSupport.ts` | Fail-fast platform check for `AsyncLocalStorage` availability   |

`run.ts` now delegates to `createRunShutdownController()` which owns the
`BootstrapCoordinator`, process shutdown hooks, disposal signal controller, and
the `disposeAll` / `disposeWithShutdownLifecycle` functions. The entrypoint code
has been reduced from ~280 lines to ~90 lines.

---

### Active Runtime Tracking Extracted

The `activeRunResults` set and the test-only `__disposeActiveRunResultsForTests`
/ `__snapshotActiveRunResultsForTests` helpers have been moved from `run.ts`
into dedicated modules:

- `src/runtime/activeRunResults.ts` — `registerActiveRunResult()`,
  `unregisterActiveRunResult()`
- `src/runtime/activeRunResultsForTests.ts` — test cleanup utilities

---

### `StoreRegistry` Extracted from `Store`

`Store` now delegates definition storage and lookup to a dedicated
`StoreRegistry`. The registry owns tasks, resources, events, hooks, middleware,
tags, errors, and async contexts. `Store` focuses on lifecycle management,
locking, and the runtime facade.

New methods on `Store`:

- `resolveRegisteredDefinition(definition)` — resolves a definition to its
  concrete registered instance owned by this store.
- `resolveHookTargets(hook)` — delegates to `StoreRegistry.resolveHookTargets()`
  for selector resolution.
- `getAccessViolation(targetId, consumerId, channel)` — returns the concrete
  visibility violation for a target-consumer pair.
- `hasExportsDeclaration(resourceId)` — checks if a resource declared an
  exports boundary.
- `cancelDrainWaiters()` — cancels pending drain waiters during forced disposal.

---

### `BootstrapCoordinator` Enhanced

The `BootstrapCoordinator` now supports phase-scoped signals:

- `withPhaseSignal(phaseName, fn)` — runs a sub-phase with a cooperative abort
  signal that fires when shutdown is requested mid-bootstrap.
- `requestShutdown(reason?)` accepts an optional reason string.
- `throwIfShutdownRequested(phase)` now includes the phase name in the
  cancellation error.

---

### Hook Target Resolution

A new `resolveHookTargets()` function in `src/models/hook/resolveHookTargets.ts`
handles the complete hook-to-event resolution pipeline:

- Resolves exact refs with fail-fast validation
- Expands `subtreeOf(...)` filters against registered events
- Evaluates predicate functions against the registered set
- Filters all matches by visibility on the `listening` channel
- Tags resolved targets with provenance (`"exact"` vs `"selector"`)

The resolution results are cached within `StoreRegistry` and invalidated on
store initialisation and override processing.

---

### Shutdown Disposal Lifecycle: Force Checkpoints

`runShutdownDisposalLifecycle()` now checks the force disposal controller at
each phase boundary:

1. Before cooldown
2. Before cooldown window wait
3. Before `events.disposing` emission
4. Before drain wait
5. Before `events.drained` emission

Any force request at these checkpoints causes the lifecycle to skip directly to
resource disposal.

---

### Visibility Tracker Enhancements

- `throwAccessViolation.ts` — centralised function for throwing visibility or
  isolation violations with consistent error formatting.
- `visibilityAccess.ts` — exported `getRootAccessInfo()`,
  `findVisibilityViolation()`, and `hasExportsDeclaration()` helpers.
- `visibilityValidation.ts` — hook event targets validated via
  `resolveHookTargets()` at bootstrap; selector targets skip inaccessible events
  silently while exact refs fail fast.
- `IsolationChannel` now parameterises `isItemVisibleToConsumer()` and
  `getAccessViolation()`.

---

### Redis Cache Provider: Ref-Based Invalidation

The Node.js Redis cache provider (`src/node/cache/redisCache.ts`) now supports
ref-based invalidation:

- Cache entries can be tagged with refs on `set()`
- `invalidateByRef(ref)` deletes all entries linked to a ref via Redis sorted
  sets
- LRU tracking and budget enforcement work across instances

---

### Redis Cache: Cross-Task Ref Unlinking Fix

Shared-budget eviction in `RedisCache` could remove entries belonging to a
different task cache. The ref membership set was always keyed by the current
instance's task token, causing stale ref pointers when eviction crossed task
boundaries. The unlink logic now uses the evicted entry's task token so the
correct ref membership set is cleaned up.

---

### Cache Resource: Resilient Ref Invalidation

`invalidateRefs()` is a best-effort fan-out across all task-local caches. A
failure in one provider no longer stops the remaining targets from cleaning up.
Errors are logged with the cache source and ref details, and invalidation
continues across the remaining task caches.

Concurrent invalidations for the same task now reuse in-flight provider
creation promises instead of creating duplicate disposable cache instances.

---

### Improved Access Violation Error Remediation

The `runtimeAccessViolationError` remediation message now distinguishes between
three states:

- Root does not declare any exports (no isolation policy)
- Root declares exports and currently exports specific ids
- Root declares exports but currently exports none

This provides clearer guidance when debugging runtime API access violations.

---

## Bug Fixes

### Durable Workflows

#### Execution Timeout Now Fails Gracefully Instead of Throwing Invariant Error

**Previously:** when a durable execution timed out, `ExecutionManager` threw a
`durableExecutionInvariantError`, which could crash the worker process or leave
the execution in an inconsistent state.

**Now:** timed-out executions are marked as `Failed` with a `"timed_out"`
reason through the normal failure path. The execution is properly audited and
finished notifications are sent. Timeouts no longer trigger retries — a
timed-out execution fails immediately regardless of remaining attempts.

---

#### DurableWorker Respects `maxAttempts` on Nack

**Previously:** `DurableWorker` always nacked with `requeue: true`, so messages
that had exhausted their retry budget kept cycling through the queue
indefinitely.

**Now:** nack only requeues when `message.attempts < message.maxAttempts`.
Exhausted messages are dead-lettered or discarded by the broker.

---

#### DurableService No Longer Re-Kicks Retrying Executions

**Previously:** `DurableService.rehydrate()` included `ExecutionStatus.Retrying`
in the set of statuses that trigger `kickoffExecution()`, which could
re-dispatch an execution that was already waiting for its retry delay.

**Now:** only `Pending`, `Running`, and `Sleeping` executions are re-kicked
during rehydration.

---

#### Schedule Update Now Properly Reschedules Active Timers

**Previously:** `ScheduleManager.update()` wrote the new pattern to the store
but did not reschedule the timer. An active schedule with a changed cron or
interval would keep firing on the old cadence until the next manual
reschedule.

**Now:** `update()` reschedules the timer when cron or interval changes. For
input-only updates on active schedules, the existing `nextRun` is preserved
and the timer is re-armed with the updated input. Inactive schedules skip
timer operations entirely.

---

#### Schedule Resume Preserves Active Status

**Previously:** `ScheduleManager.resume()` called `reschedule()` with the
stored schedule object, which might still carry `paused` status in the local
copy even though the store had already been updated.

**Now:** `resume()` merges `status: Active` into the schedule before
rescheduling, ensuring the timer is always armed with the correct status.

---

### RabbitMQ Queue Improvements

#### Accurate Attempt Tracking via `x-delivery-count` Header

**Previously:** RabbitMQ queue message attempt counts relied solely on
in-memory tracking and the serialized `attempts` field. Broker-level redeliveries
(connection drops, nack-requeue cycles) were invisible, causing attempt counters
to undercount.

**Now:** both `RabbitMQQueue` and the underlying `createConsumeHandler` receive
the full `ConsumeMessage` (including `properties.headers`). The
`x-delivery-count` header — set by RabbitMQ's quorum queues and some
plugins — is factored into the attempt calculation:

```ts
nextAttempts = Math.max(localAttempts, serializedAttempts, headerAttempts) + 1;
```

This ensures message handlers see accurate attempt numbers even after
broker-level redeliveries.

---

## Documentation

- `guide-units/02c-events-and-hooks.md` — added Mermaid sequence diagrams for
  event emission flow and transactional rollback, documented selector-based hook
  targets with `subtreeOf(...)` and predicates, clarified `tags.excludeFromGlobalHooks` interaction with selectors.
- `guide-units/02d-middleware.md` — expanded middleware documentation with new
  cache ref invalidation patterns.
- `guide-units/03-runtime-lifecycle.md` — documented forced disposal mode,
  external abort signal integration, and interruptible bootstrap phases.
- `guide-units/02-resources.md` — added framework namespace resource
  documentation for `system` and `runner`.
- `guide-units/04c-multi-tenant.md` — added cache ref scoping notes for tenant
  mode.
- `guide-units/05-observability.md` — observability updates.
- `guide-units/06-meta-and-internals.md` — documented `StoreRegistry`
  extraction.
- `readmes/AI.md` — updated with `signal` run option, `dispose({ force: true })`
  semantics, hook selector subscription forms, cache `keyBuilder` ref support,
  `invalidateRefs()`, framework namespace resources, and `tag.startup()`.
- `readmes/FLUENT_BUILDERS.md` — hook builder selector support.

---

## Test Coverage

All new functionality ships with full test coverage:

| Test File                                         | Focus                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `run.disposal-signal.test.ts`                     | External abort signal bootstrap cancellation and disposal triggering                            |
| `runtime.force-dispose.test.ts`                   | Forced disposal escalation, skipped lifecycle phases, budget enforcement                        |
| `run.hook.selectors.test.ts`                      | Hook selector resolution with subtreeOf, predicates, and mixed arrays                           |
| `run.runtime-exports.transitive.test.ts`          | Transitive export visibility in runtime APIs                                                    |
| `resolveHookTargets.test.ts`                      | Unit tests for resolution logic, visibility filtering, provenance tagging                       |
| `BootstrapCoordinator.test.ts`                    | State machine, phase signals, shutdown coordination                                             |
| `runDisposalSignal.test.ts`                       | Signal listener cleanup, bootstrap interop, edge cases                                          |
| `shutdownDisposalLifecycle.force.test.ts`         | Force disposal at each lifecycle phase, budget enforcement                                      |
| `StoreRegistry.facade.test.ts`                    | Registry delegation, definition storage                                                         |
| `activeRunResultsForTests.test.ts`                | Test-only runtime cleanup utilities                                                             |
| `buildDependencyGraph.branches.test.ts`           | Dependency graph edge cases                                                                     |
| `Store.test.ts` (expanded)                        | New Store methods: `resolveRegisteredDefinition`, `cancelDrainWaiters`, `hasExportsDeclaration` |
| `Store.coverage.test.ts` (expanded)               | Coverage for cooperative ready/cooldown guards                                                  |
| `cache.middleware.test.ts` (expanded)             | Ref-based cache key builders and invalidation                                                   |
| `cache.shared.test.ts` (expanded)                 | Shared budget with ref tracking                                                                 |
| `cache.key.test.ts`                               | Default key builder fallback behaviour                                                          |
| `tenantScope.middleware.test.ts` (expanded)       | Cache ref scoping under tenant context                                                          |
| `LifecycleAdmissionController.test.ts` (expanded) | Cancel drain waiters during force disposal                                                      |
| `redisCache.test.ts` (expanded)                   | Redis ref-based invalidation                                                                    |
| `redisCacheProvider.resource.test.ts` (expanded)  | Redis provider resource wiring with refs                                                        |
| `events.type-test.ts` (expanded)                  | Type-level tests for selector-based hook builder                                                |
| `define/events.type-test.ts` (expanded)           | Type-level tests for `HookOnPredicate`, `HookSelectorTarget`                                    |
| `cache-provider.type-test.ts` (expanded)          | Type-level tests for `CacheKeyDescriptor`                                                       |

Additional test files in the latest round:

| Test File                                           | Focus                                                                 |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| `cache.resource.invalidate-refs.test.ts`            | Resilient ref invalidation fan-out, concurrent provider dedup         |
| `runShutdownController.test.ts`                     | Shutdown controller integration, force dispose propagation            |
| `runtimeAccessViolationError.test.ts`               | Remediation message variants for export states                        |
| `redisCache.refs.test.ts`                           | Cross-task ref unlinking in Redis cache                               |
| `DurableService.execution.unit.test.ts` (expanded)  | Timeout failure path, graceful execution marking                      |
| `DurableService.scheduling.unit.test.ts` (expanded) | Schedule update rescheduling, resume status, input-only updates       |
| `DurableWorker.test.ts` (expanded)                  | Nack respects maxAttempts                                             |
| `RabbitMQQueue.mock.test.ts`                        | `x-delivery-count` header parsing, attempt tracking                   |
| `RunResult.coverage.test.ts` (expanded)             | `shutdownLockdownError` during force dispose                          |
| `VisibilityTracker.deny-mode.test.ts` (expanded)    | Deny-mode isolation channel access checks                             |

111 files changed, 7121 insertions, 830 deletions across source, tests, and
documentation.
