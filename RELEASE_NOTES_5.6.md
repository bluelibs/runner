# BlueLibs Runner 5.6 — Release Notes

> **235 files changed** — ~14,800 additions, ~5,600 deletions

## Highlights

- **Resource Isolation** — fine-grained visibility boundaries with `deny`, `only`, and `exports` policies
- **Middleware Auto-Application** — `.applyTo("where-visible" | "subtree")` is now a **registration-level** concern (`middleware.build().applyTo(...)`)
- **Strict Fluent Builder Ordering** — compile-time phased constraints for `task`, `hook`, `resource`, and middleware builders
- **Tag Dependency Injection** — inject tags as dependencies to query tagged definitions at runtime
- **Tag Target Scoping** — `.for(["tasks"])` restricts which definition kinds a tag may be attached to
- **Deep-Frozen Definitions** — all `build()`, `.with()`, `.fork()`, and `.optional()` outputs are now deeply immutable
- **Override Simplification** — 5 legacy override builder classes replaced with a single `r.override(base, fn)` shorthand
- **StoreRegistry Decomposition** — internal registry split into focused sub-modules (Writer, TagIndex, MatchCollector, DefinitionPreparer)
- **Shutdown Lockdown + Grace Window** — on shutdown signals, Runner blocks new task/event admissions, waits up to `shutdownGracePeriodMs` (default `30_000`), and now handles shutdown requests that arrive during bootstrap gracefully
- **Lifecycle Event Contract Cleanup** — `globals.events.ready` is the canonical startup event; disposal now emits awaited `globals.events.disposing`, performs drain, then emits awaited `globals.events.drained`; `globals.events.shutdown` is reserved for signal-hook shutdown flow

---

## New Features

### Strict Fluent Builder Ordering

`r.*` strict builders now enforce phase-aware ordering in TypeScript while preserving ergonomic metadata chaining.

- `task`: after `.run()`, `dependencies`, `inputSchema/schema`, `resultSchema`, `middleware`, and `tags` are locked; `.meta()`, `.throws()`, and `.build()` remain valid.
- `hook`: `.run()` requires `.on(...)` first; after `.run()`, `on`, `dependencies`, and `tags` are locked; `.build()` requires both `.on()` and `.run()`.
- `task/resource middleware`: after `.run()`, `dependencies`, `configSchema/schema`, and `tags` are locked; `.build()` requires `.run()`.
- `resource`: after `.init()`, `dependencies`, `configSchema/schema`, `resultSchema`, `middleware`, `tags`, and `context` are locked; `.init()` remains optional.
- `meta` remains allowed both before and after `.run()` / `.init()` (only shape/wiring methods are phase-locked).

### Resource Isolation (`.isolate()`)

Resources now support an `.isolate(policy)` method (replaces the earlier `.exports()` API) that defines a dependency boundary around a resource's subtree. Three modes are available:

```ts
// Blocklist — deny specific targets from being referenced inside this subtree
r.resource("app.secure").isolate({
  deny: [dangerousTask, "some.id", unsafeTag],
});

// Allowlist — only listed targets (+ internal items) may be referenced
r.resource("app.sandboxed").isolate({ only: [allowedTask, safeTag] });

// Exports — control what the outside world can see from this subtree
r.resource("app.module").isolate({ exports: [publicTask, publicEvent] });
// exports: "none" or exports: [] hides everything
```

- **Deny** and **only** are enforced at wiring time (bootstrap) — violations are caught before the app starts.
- **Exports** are enforced both at wiring time and at runtime (`runTask`, `emitEvent`, `getResourceValue`, `getLazyResourceValue` check the root's export surface).
- Policies are additive across ancestors (effective external access is the intersection of ancestor `only` lists).
- `deny` and `only` cannot coexist on the same resource — Runner fails fast with a clear error.
- String selector support: `deny` / `only` / `exports` accept wildcard id selectors (`*` = one dot-segment); selectors that match nothing fail fast at bootstrap.
- Tag-based deny/only: using a tag definition (`deny: [myTag]`) blocks/allows all definitions bearing that tag; using a tag id string (`deny: [myTag.id]`) matches only that exact id.
- Enforcement scope includes dependencies, hook event subscriptions, and middleware attachments, so these rules apply equally to tasks/resources/events/hooks/middleware/errors/async-contexts/tags.

### Middleware Auto-Application (`.applyTo()`)

Middleware auto-application scope is declared at registration time using `.applyTo()`:

```ts
const auditTasks = r.middleware
  .task("app.middleware.audit")
  .run(async ({ task, next }) => next(task.input))
  .build();

const localCache = r.middleware
  .resource("app.middleware.cache")
  .run(async ({ value, next }) => next())
  .build();

const auditTasksRegistration = auditTasks.applyTo(
  "where-visible",
  (task) => !task.id.startsWith("admin."),
);
const localCacheRegistration = localCache.applyTo("subtree");
```

- `"where-visible"` — auto-applies to all targets visible to the middleware (respects isolation boundaries).
- `"subtree"` — auto-applies only within the declaring resource's own subtree (declaring resource + descendants).
- Optional `when` predicate filters targets further.
- Middleware builders expose scoped registration via `.applyTo(...)` only.

### Tag Dependency Injection

Tags can now be declared as dependencies. The injected accessor provides lazy, cached, visibility-filtered access to all definitions bearing that tag:

```ts
const httpRouteTag = r
  .tag("app.tags.httpRoute")
  .configSchema<{ method: string; path: string }>({ parse: (v) => v })
  .build();

const router = r
  .resource("app.router")
  .dependencies({ httpRouteTag })
  .init(async (_config, { httpRouteTag }) => {
    // Typed accessor with tasks, resources, events, hooks, etc.
    for (const entry of httpRouteTag.tasks) {
      console.log(entry.definition.id, entry.config);
    }
  })
  .build();
```

- Accessors include `tasks`, `resources`, `events`, `hooks`, `taskMiddlewares`, `resourceMiddlewares`, `errors`.
- Task entries include `.run()` and `.intercept()` helpers; resource entries include a live `.value` getter.
- `.startup()` resolves the accessor before resource `init` (for ordering-sensitive scenarios).
- `.optional()` injects `undefined` if the tag isn't registered.
- Results respect isolation boundaries — items hidden by `.isolate({ exports: "none" })` are filtered out.

### Tag Target Scoping (`.for()`)

Tags can be restricted to specific definition kinds:

```ts
const taskOnlyTag = r.tag("app.tags.taskOnly")
  .for(["tasks"])
  .build();

// ✅ Compiles and passes runtime check
r.task("app.tasks.valid").tags([taskOnlyTag]).run(...).build();

// ❌ TypeScript error + runtime `tagTargetNotAllowedError`
r.resource("app.bad").tags([taskOnlyTag]).build();
```

- Supported targets: `"tasks"`, `"resources"`, `"events"`, `"hooks"`, `"taskMiddlewares"`, `"resourceMiddlewares"`, `"errors"`.
- Validation is both compile-time (phantom types filter incompatible tags to `never`) and runtime (fail-fast at build time).

### Deep-Frozen Definitions

All definition outputs are now deeply immutable:

- `build()` on all builders (tasks, resources, events, hooks, middleware, tags, errors, async contexts) deep-freezes the result.
- `.with(config)`, `.fork(id)`, `.optional()`, and `r.override(base, fn)` propagate immutability from their parent — if the source is frozen, the derived output is also frozen.
- `deepFreeze` is circular-reference-safe and skips non-plain class instances at depth > 0 (avoids breaking Zod schemas, ORM models, etc.).

---

## Breaking Changes

### Override Builder Removal

The 5 dedicated override builder classes (`r.override.task(...)`, `r.override.resource(...)`, `r.override.hook(...)`, `r.override.taskMiddleware(...)`, `r.override.resourceMiddleware(...)`) have been removed (~1,450 lines deleted). Use the shorthand instead:

```ts
// Before (5.5)
const mock = r.override
  .task(realTask)
  .run(async () => mockResult)
  .build();

// After (5.6)
const mock = r.override(realTask, async () => mockResult);
```

- The shorthand auto-detects the definition kind via type guards.
- For tasks/hooks/middleware: replaces `run`. For resources: replaces `init`.
- Type-safe with 5 overload signatures ensuring `fn` matches the correct shape.

---

## Deprecations

### `.exports()` → `.isolate({ exports: [...] })`

The top-level `.exports([...])` method on the resource builder is deprecated but **still functional**. Prefer `.isolate({ exports: [...] })` instead. Using both simultaneously throws `isolateExportsConflictError`.

---

## Internal Improvements

### StoreRegistry Decomposition

The monolithic `StoreRegistry` has been split into focused sub-modules:

| Module                            | Responsibility                                                            |
| --------------------------------- | ------------------------------------------------------------------------- |
| `StoreRegistryWriter`             | All mutation logic (storing tasks, resources, hooks, etc.)                |
| `StoreRegistryTagIndex`           | Tag indexing, bucket management, and `TagDependencyAccessor` construction |
| `StoreRegistryTagMatchCollector`  | Collecting tagged matches with visibility filtering                       |
| `StoreRegistryDefinitionPreparer` | Override merging and dynamic dependency factory resolution                |
| `StoreRegistry`                   | Thin facade delegating to sub-modules                                     |

### EventManager Decomposition

The `EventManager` has been refactored into focused modules:

| Module                | Responsibility                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `ListenerRegistry`    | Per-event + global listener collections with binary-insertion ordering and merge caching |
| `EmissionExecutor`    | Sequential & parallel emission execution with failure-mode handling                      |
| `CycleContext`        | AsyncLocalStorage-based runtime cycle detection for emission chains                      |
| `InterceptorPipeline` | Generic LIFO interceptor composition                                                     |

### VisibilityTracker

New internal model responsible for enforcing all visibility rules — compile-time isolation validation, export surface checks, access violation reporting, and tag accessor filtering.

### DependencyProcessor Enhancements

- **Parallel wave initialization**: `initializeUninitializedResourcesParallel()` runs resources in waves — each wave initializes all resources whose dependencies are already ready.
- **Startup resource collection**: Smarter traversal identifies exactly which resources require eager initialization vs. lazy.
- **Task initialization deduplication**: `inFlightTaskInitializations` prevents concurrent re-initialization of the same task.
- **Owner-aware middleware proxies**: Resource-scoped interceptors are correctly attributed to their owning resource.

### Other

- `buildDependencyGraph` now includes middleware auto-application edges and visibility/subtree-scope checks.
- Improved `StoreValidator` with dedicated tag validation passes (unique tags per definition, registered tag checks, self-tag dependency prevention).
- Error system expanded with isolation/visibility-specific errors (`isolateViolation`, `isolateConflict`, `isolateExportsConflict`, `tagTargetNotAllowed`).
- Shared in-flight idle tracking utility introduced for task/event execution paths:
  - removes duplicate wait-for-idle logic across `TaskRunner` and `EventManager`
  - applies consistent defensive decrement behavior
  - keeps graceful-drain behavior centralized for shutdown paths
- Consistency cleanup:
  - `StoreRegistryWriter` now uses `storingMode` consistently for task/resource middleware writer siblings
  - `defineTaskMiddleware` / `defineResourceMiddleware` now follow the same direct import style pattern

---

## Observations (Non-Blocking)

During the audit, several items were noted that aren't bugs but may warrant future attention:

1. **File size violations** — Several files exceed the project's 300-line soft limit:
   - `foundation.errors.ts` (685 lines) — could be split thematically
   - `DependencyExtractor.ts` (502 lines) — Proxy-based middleware manager and tag accessor construction are extraction candidates
   - `ResourceScheduler.ts` (473 lines) — near-duplicate traversal implementations (`traverseDirectDependency` vs `traverseDependency`) could be unified
   - `StoreRegistryWriter.ts` (409 lines) — `RegisterableKind` enum and helpers could be extracted

2. **`getItemTypeLabel()` in VisibilityTracker** — Always returns `"Item"` regardless of input; both parameters are voided. Error messages lose diagnostic specificity (says "Item" instead of "Task", "Resource", etc.).

3. **`StoreRegistryDefinitionPreparer` uses non-null assertion** — `collection.get(item.id)!` in override mode could produce a cryptic TypeError instead of a descriptive Runner error if the base definition is missing.





