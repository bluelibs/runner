# Runner 6.3 Release Notes

## Highlights

Runner 6.3 introduces **external abort signal integration** for runtime
lifecycle control, **forced disposal escalation** that escapes stuck graceful
shutdowns, **selector-based hook targets** that subscribe to entire resource
subtrees or predicate-matched events at bootstrap time, and **semantic cache
invalidation via refs** that enables cross-task cache purging by domain
identity.

The **tenant → identity rename** is the most significant breaking change in
this release: `asyncContexts.tenant` becomes `asyncContexts.identity`,
`ITenant` becomes `IIdentity` with newly optional `tenantId` and an added
`userId` field, `tenantScope` middleware config becomes `identityScope` across
all built-in middleware (cache, rate limit, debounce/throttle, concurrency),
and a rich `IdentityScopeMode` replaces the simple `"auto" | "required" |
"off"` union with user-aware partitioning modes (`"auto:userId"`,
`"required:userId"`, `"full"`).

A new **pluggable identity context** via `run(app, { identity })` lets
applications supply a custom async context that Runner reads for all
identity-aware framework behaviour — middleware partitioning, scope keys, and
the new `identityContextResource` all bind to the configured context instead of
hard-coded `asyncContexts.identity`.

**Keyed middleware capacity management** adds `maxKeys` to rate limit and
temporal (debounce/throttle) middleware configs with automatic stale-state
pruning and a new `middlewareKeyCapacityExceededError` when the limit is
breached. Default key builders now include serialized input so different
payloads no longer silently share the same middleware bucket.

**Event Lane topology hook policies** introduce `hooks.only` allowlists on
consume entries, replacing the deprecated `tags.eventLaneHook` tag-based
approach. Tag-based event lane routing (`tags.eventLane`) is also deprecated in
favour of `r.eventLane(...).applyTo(...)`.

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

- **Breaking:** `asyncContexts.tenant` → `asyncContexts.identity` with
  `IIdentity { tenantId?: string; userId?: string }`.
- **Breaking:** `tenantScope` → `identityScope` across all built-in middleware,
  with new modes including `"auto:userId"`, `"required:userId"`, and `"full"`.
- **Breaking:** Event Lane topology profiles now use
  `consume: [{ lane, hooks? }]` instead of `consume: [lane]`.
- Pass an external `AbortSignal` to `run()` to cancel bootstrap or trigger
  graceful disposal without polluting ambient execution context signals.
- Call `runtime.dispose({ force: true })` to skip remaining graceful phases and
  jump directly to resource disposal.
- Hook `.on(...)` now accepts `subtreeOf(resource)`, predicate functions, and
  mixed arrays alongside exact event references.
- Cache key builders can return `{ cacheKey, refs }` and call
  `cacheResource.invalidateRefs(...)` to purge entries by semantic identity.
- Use `run(app, { identity: myAsyncContext })` to override the runtime identity
  source for all middleware partitioning.
- Rate limit and temporal middleware accept `maxKeys` to cap tracked key
  cardinality and avoid unbounded memory growth.
- Event Lane hook policies via `consume[].hooks.only` filter which hooks run
  during relay re-emits.
- The `isOneOf()` event guard now requires definition identity — arbitrary
  `{ id }`-shaped objects no longer match.
- Bootstrap phases are now interruptible: shutdown requested mid-startup
  cooperatively stops remaining ready waves.
- Internal framework resources (`system`, `runner`) now carry metadata for
  tooling and documentation.

---

## Breaking Changes

### Tenant → Identity Rename

The entire tenant subsystem has been renamed to "identity" to reflect that the
context now carries both tenant and user dimensions.

| Before (6.2)                           | After (6.3)                                  |
| -------------------------------------- | -------------------------------------------- |
| `asyncContexts.tenant`                 | `asyncContexts.identity`                     |
| `ITenant`                              | `IIdentity`                                  |
| `TenantContextValue`                   | `IdentityContextValue`                       |
| `tenantScope` (middleware config)      | `identityScope`                              |
| `TenantScopeMode`                      | `IdentityScopeMode`                          |
| `TenantScopedMiddlewareConfig`         | `IdentityScopedMiddlewareConfig`             |
| `TenantScopeConfig`                    | `IdentityScopeConfig`                        |
| `tenantContextRequiredError`           | `identityContextRequiredError`               |
| `tenantInvalidContextError`            | `identityInvalidContextError`                |
| `tenant.asyncContext.ts`               | `identity.asyncContext.ts`                    |
| `tenantScope.shared.ts`               | `identityScope.shared.ts`                    |

**`IIdentity` payload changes:**

```ts
// Before (6.2)
interface ITenant {
  tenantId: string; // required
}

// After (6.3)
interface IIdentity {
  tenantId?: string; // now optional
  userId?: string;   // new, optional
}
```

Both fields are optional at the ambient context level so apps can establish
identity gradually across request/auth boundaries. Middleware that opts into
identity partitioning validates the fields it actually needs at use time.

**Fix:** rename all `tenantScope` middleware config keys to `identityScope`,
replace `ITenant` / `TenantContextValue` with `IIdentity` /
`IdentityContextValue`, and update `asyncContexts.tenant` references to
`asyncContexts.identity`.

---

### Identity Scope Modes Expanded

The simple `"auto" | "required" | "off"` union is replaced by a richer
`IdentityScopeMode`:

| Mode               | Behaviour                                                      |
| ------------------ | -------------------------------------------------------------- |
| `"auto"`           | Partition by `tenantId` when present (same as old `"auto"`)    |
| `"auto:userId"`    | Like `"auto"` but appends `userId` when present                |
| `"required"`       | Require `tenantId` (same as old `"required"`)                  |
| `"required:userId"`| Require `tenantId` + append `userId` when present              |
| `"full"`           | Require both `tenantId` AND `userId`, prefix as `<tenantId>:<userId>:…` |
| `"off"`            | Disable identity partitioning (same as old `"off"`)            |

**Fix:** existing `tenantScope: "auto"` migrates to `identityScope: "auto"` and
keeps the same semantics. Only update the config key name unless you want finer
user-aware scoping.

---

### Event Lane Topology Profile Consume Shape

Profile `consume` arrays now contain entry objects instead of bare lane
references:

```ts
// Before (6.2)
profiles: {
  worker: { consume: [ordersLane, paymentsLane] }
}

// After (6.3)
profiles: {
  worker: {
    consume: [
      { lane: ordersLane },
      { lane: paymentsLane, hooks: { only: [auditHook] } },
    ]
  }
}
```

**Fix:** wrap each lane reference in `{ lane: <ref> }`. Optionally add
`hooks: { only: [...] }` for hook policy filtering.

---

### Default Middleware Key Builder Now Includes Serialized Input

**Previously:** the default key builder for rate limit and temporal middleware
returned the bare `taskId`, so all calls to the same task shared a single
bucket regardless of input.

**Now:** the default key builder returns
`canonicalTaskKey + ":" + serialized(input)`, so different payloads get
isolated middleware state. A `MiddlewareKeyBuilderHelpers` object is passed as
the third argument to custom key builders.

**Fix:** if your middleware intentionally shares state across all inputs for a
task, provide an explicit `keyBuilder: (taskId) => taskId`.

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
- Refs are indexed alongside cache entries and scoped by identity when
  `identityScope` is active.
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

### Pluggable Identity Context via `run(..., { identity })`

Applications can now override which async context Runner reads for all
identity-aware framework behaviour by passing `identity` to `run()`:

```ts
import { r, run, asyncContexts } from "@bluelibs/runner";

// Define a custom identity async context
const myIdentity = r.asyncContext("myIdentity").build();

const runtime = await run(app, {
  identity: myIdentity,
});
```

When specified, all built-in middleware (cache, rate limit, debounce/throttle,
concurrency) read identity from the supplied context instead of the default
`asyncContexts.identity`. The identity context is surfaced as the system
`identityContextResource` and automatically registered in the store.

Requires `AsyncLocalStorage` support — a
`identityRunOptionRequiresAsyncLocalStorageError` is thrown at startup on
platforms without it.

New types:

| Type                   | Description                                             |
| ---------------------- | ------------------------------------------------------- |
| `IdentityAsyncContext` | Async context accessor compatible with `run({ identity })` |

---

### Keyed Middleware Capacity Management (`maxKeys`)

Rate limit and temporal middleware now accept an optional `maxKeys` config that
caps the number of distinct live keys tracked per config instance:

```ts
const limited = rateLimitTaskMiddleware.with({
  windowMs: 60_000,
  max: 10,
  maxKeys: 1_000,
});

const debounced = debounceTaskMiddleware.with({
  ms: 500,
  maxKeys: 500,
});
```

When a new key would exceed the limit, Runner first prunes stale/expired
entries. If the count is still at capacity, a
`middlewareKeyCapacityExceededError` (HTTP 429) is thrown.

Background cleanup timers are managed by the extracted `temporalResource` and
`rateLimitResource`, sweeping idle keys at an interval derived from the
shortest configured window.

New error:

| Error                                | HTTP | Description                                  |
| ------------------------------------ | ---- | -------------------------------------------- |
| `middlewareKeyCapacityExceededError`  | 429  | Key cardinality exceeded `maxKeys` threshold |

---

### Event Lane Topology Hook Policies

Consume entries in Event Lane topology profiles can now declare hook allowlists
that filter which hooks run during relay re-emits:

```ts
const eventLanes = r.eventLane("orders").build();

const auditHook = r.hook("audit").on("*").run(async () => {}).build();
const metricsHook = r.hook("metrics").on("*").run(async () => {}).build();

const app = r
  .resource("app")
  .register([eventLanes, auditHook, metricsHook])
  .with({
    eventLanes: {
      topology: {
        profiles: {
          worker: {
            consume: [
              // Only auditHook runs for relayed orders events
              { lane: eventLanes, hooks: { only: [auditHook] } },
            ],
          },
        },
      },
    },
  })
  .build();
```

When `hooks.only` is specified, the relay interceptor checks the allowlist
before executing each hook. Hooks not in the list are silently skipped. Omit
`hooks` entirely to allow all hooks (default behaviour).

Bootstrap validates that all hook references in `hooks.only` are registered,
throwing `eventLaneHookPolicyHookReferenceInvalidError` for unknown hooks.
Duplicate lane entries within a profile are caught by
`eventLaneConsumeDuplicateLaneError`.

---

### Identity Context Resource

A new system resource `identityContextResource` wraps the active identity
async context (either the default `asyncContexts.identity` or a custom one
supplied via `run({ identity })`). Built-in middleware now depends on this
resource instead of directly importing the global identity async context:

```ts
// Internal middleware usage
dependencies: {
  identityContext: identityContextResource,
},
async run({ task, next }, { identityContext }, config) {
  const identity = identityContext?.tryUse();
  // ...
}
```

This indirection is what enables the pluggable identity described above.

---

## Behavioural Changes

### Deprecated: Tag-Based Event Lane Routing

`globalTags.eventLane` is now deprecated. Using it throws
`eventLaneTagDeprecatedError` at bootstrap with a remediation pointing to
`r.eventLane(...).applyTo(...)`.

Similarly, `globalTags.eventLaneHook` is deprecated in favour of topology
`consume[].hooks.only` configuration. Using the tag throws
`eventLaneHookTagDeprecatedError`.

The old tag-based routing code path that resolved `eventLane` tags into lane
assignments has been removed from `EventLaneAssignments`. Only `applyTo()`
-based routing is supported going forward.

---

### Transactional Event Lane Conflict Moved to Controller

**Previously:** transactional events were validated against `eventLane` tags in
the universal `EventValidator`.

**Now:** transactional validation against event lane assignments happens inside
`EventLanesController` after topology resolution, using the actual resolved
route map. The error payload now includes `laneId` instead of `tagId`.

---

### Rate Limit Errors Use Runner Error System

**Previously:** `RateLimitError` was a custom `RunnerError` subclass thrown via
`throw new RateLimitError(...)`.

**Now:** rate limit violations use the standard
`middlewareRateLimitExceededError.throw(...)` pattern consistent with all other
Runner errors.

---

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

### Rate Limit and Temporal Resource Extraction

The `rateLimitResource` and `temporalResource` have been extracted from their
respective middleware files into dedicated resource modules
(`rateLimit.resource.ts`, `temporal.resource.ts`). Resource state now includes
proper lifecycle management:

- Background cleanup timers sweep stale keyed state at intervals derived from
  the shortest configured window.
- `cooldown()` cancels timers; `dispose()` clears tracked state and rejects
  in-flight debounce/throttle promises.
- Fine-grained pruning functions are exported for use by middleware capacity
  enforcement.

A new shared module `keyedState.shared.ts` centralises `ensureKeyedStateCapacity`,
`deriveKeyedStateCleanupInterval`, and `syncCleanupTimer` logic used by both
resources.

---

### Event Lane Assignment Refactoring

Tag-based event lane routing has been removed from `resolveEventLaneAssignments()`.
Only `applyTo()`-based lane assignments are now resolved. The deprecated
`globalTags.eventLane` and `globalTags.eventLaneHook` tags throw bootstrap
errors when used.

The `EventLanesInternals` module now builds per-lane hook allowlists from
topology `consume[].hooks.only`, and relay interceptors check these allowlists
before executing hooks during relay re-emits.

---

### Middleware Key Builder Helpers

Custom key builders now receive a `MiddlewareKeyBuilderHelpers` third argument:

```ts
interface MiddlewareKeyBuilderHelpers {
  canonicalKey: string; // task id minus the ".tasks." namespace marker
}
```

The default key builder uses `canonicalKey + ":" + serialized(input)` to produce
stable, human-readable partition keys. Non-serializable inputs throw a
`validationError` with a remediation suggesting an explicit `keyBuilder`.

---

### Store Auto-Registers Runtime Identity Context

`Store.initializeStore()` now calls `ensureRuntimeIdentityContextRegistered()`
to guarantee the active identity async context is registered in the store,
even if it was not explicitly added to the app's registration tree. This
enables middleware that depends on `identityContextResource` to resolve correctly
regardless of how identity was configured.

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

#### Delivery-Exhausted Executions Properly Failed

**Previously:** when a message exhausted its delivery attempts in the queue
(e.g. maxAttempts reached), the execution could be left in a non-terminal
state if the worker nacked the message.

**Now:** `ExecutionManager.failExecutionDeliveryExhausted()` transitions the
execution to `Failed` with a `"delivery_attempts_exhausted"` reason, including
the message id, attempt counts, and the error message. Terminal executions are
skipped to avoid double-transitioning.

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
  cache ref invalidation patterns and `maxKeys` capacity management.
- `guide-units/03-runtime-lifecycle.md` — documented forced disposal mode,
  external abort signal integration, and interruptible bootstrap phases.
- `guide-units/02-resources.md` — added framework namespace resource
  documentation for `system` and `runner`.
- `guide-units/04c-multi-tenant.md` — updated for tenant → identity rename,
  added identity scope mode documentation, cache ref scoping notes for identity
  mode.
- `guide-units/05-observability.md` — observability updates.
- `guide-units/06-meta-and-internals.md` — documented `StoreRegistry`
  extraction.
- `readmes/AI.md` renamed to `readmes/COMPACT_GUIDE.md` — updated with
  `signal` run option, `dispose({ force: true })` semantics, hook selector
  subscription forms, cache `keyBuilder` ref support, `invalidateRefs()`,
  framework namespace resources, `tag.startup()`, and identity context changes.
- `readmes/FLUENT_BUILDERS.md` — hook builder selector support.
- `readmes/DURABLE_WORKFLOWS_AI.md` — durable workflow documentation updates.

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

| Test File                                                   | Focus                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `cache.resource.invalidate-refs.test.ts`                    | Resilient ref invalidation fan-out, concurrent provider dedup            |
| `runShutdownController.test.ts`                             | Shutdown controller integration, force dispose propagation               |
| `runtimeAccessViolationError.test.ts`                       | Remediation message variants for export states                           |
| `redisCache.refs.test.ts`                                   | Cross-task ref unlinking in Redis cache                                  |
| `DurableService.execution.unit.test.ts` (expanded)          | Timeout failure path, graceful execution marking                         |
| `DurableService.scheduling.unit.test.ts` (expanded)         | Schedule update rescheduling, resume status, input-only updates          |
| `DurableWorker.test.ts` (expanded)                          | Nack respects maxAttempts                                                |
| `RabbitMQQueue.mock.test.ts`                                | `x-delivery-count` header parsing, attempt tracking                      |
| `RunResult.coverage.test.ts` (expanded)                     | `shutdownLockdownError` during force dispose                             |
| `VisibilityTracker.deny-mode.test.ts` (expanded)            | Deny-mode isolation channel access checks                                |

Test files from the identity & middleware capacity round:

| Test File                                                   | Focus                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `identity.runtime-option.integration.test.ts`               | Identity run option integration: pluggable async context, middleware binding |
| `identityScope.middleware.test.ts`                          | Identity scope modes across all middleware (renamed from `tenantScope`)   |
| `keyedState.shared.test.ts`                                 | Keyed state capacity enforcement, cleanup interval derivation            |
| `rateLimit.middleware.test.ts` (expanded)                   | `maxKeys` enforcement, capacity pruning, identity scope integration      |
| `temporal.debounce.middleware.test.ts` (expanded)           | Debounce `maxKeys`, identity scope, cleanup timer lifecycle              |
| `temporal.throttle.middleware.test.ts` (expanded)           | Throttle `maxKeys`, identity scope, cleanup timer lifecycle              |
| `temporal.dispose.middleware.test.ts` (expanded)            | Dispose behaviour with cleanup timers                                    |
| `default-keyed-middleware.behavior.test.ts`                 | Default key builder serialization, canonical key, non-serializable input errors |
| `identityContext.resource.test.ts`                          | Identity context resource config validation, `tryUse()` delegation       |
| `run.identity-option.test.ts`                               | `run(app, { identity })` option wiring, platform checks                  |
| `identity-scope.type-test.ts`                               | Type-level tests for identity scope config                               |
| `key-builder-helpers.type-test.ts`                          | Type-level tests for `MiddlewareKeyBuilderHelpers`                       |
| `run-identity-option.type-test.ts`                          | Type-level tests for identity run option                                 |
| `EventValidator.coverage.test.ts`                           | Event lane hook policy validation, deprecated tag errors, duplicate lane detection |
| `globalTags.eventLane.test.ts`                              | Deprecated event lane tag validation                                     |
| `eventLanes.deprecated-tags.integration.test.ts`            | End-to-end deprecated tag error behaviour                                |
| `eventLanes.hook-isolation.integration.test.ts`             | Hook allowlist filtering in relay re-emits                               |
| `eventLane.topology.type-test.ts` (expanded)                | Type-level tests for consume entry shape                                 |
| `Store.lookup-fallback.coverage.test.ts`                    | Store lookup fallback resolution                                         |
| `Store.test.ts` (expanded)                                  | Identity context auto-registration                                       |
| `Store.sanity-transactional-events.test.ts` (updated)       | Transactional event lane conflict validation                             |
| `system.tenantContext.test.ts` (updated)                    | Renamed identity context tests                                           |
| `DurableService.scheduling.edge-cases.unit.test.ts`         | Schedule edge cases: delivery exhaustion, re-kick guards                 |
| `ExecutionManager.idempotency.cancel.unit.test.ts`          | Execution manager idempotency and cancellation                           |
| `EventLaneAssignments.unit.test.ts` (updated)               | Removed tag-based assignment tests                                       |
| `EventLanesInternals.unit.test.ts` (expanded)               | Hook allowlist building                                                  |
| `RabbitMQEventLaneQueue.mock.test.ts` (expanded)            | Delivery count header parsing                                            |
| `typed-errors.test.ts` (expanded)                           | `middlewareKeyCapacityExceededError` typing                              |

249 files changed, 21,534 insertions, 38,059 deletions across source, tests,
and documentation (83 non-test source files: +4,231 / −1,207).
