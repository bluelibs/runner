# Runner 6.2 Release Notes

## Highlights

Runner 6.2 introduces **cooperative abort-signal propagation** across tasks,
events, and middleware, adds first-class **multi-tenant support** across
built-in middleware with a dedicated **tenant async context**, exposes the
resolved runtime **mode** directly through `runtime.mode` and the new
`resources.mode` built-in, and makes resource composition callbacks mode-aware
via `(config, mode) => ...`.

This release also adds **`Match.Range`** for numeric bounds validation,
introduces a **lightweight execution context mode** (`frames: "off"`) for
signal-only propagation without frame tracking overhead, closes a long-standing
**lazy-resource wakeup race** during shutdown, hardens **subtree-vs-local
middleware conflict detection**, switches decorator-backed DTO ergonomics to
**standard ES decorators by default** while preserving a legacy compatibility
entrypoint, hydrates decorated **class schemas by default on parse**, and ships
internal refactors that simplify error IDs, runtime call sources, and the
framework root structure.

High-level takeaways:

- Abort signals flow through tasks, events, and the execution context tree,
  enabling cooperative cancellation across the runtime.
- Multi-tenant concerns are now a first-class built-in capability.
- `Match.Range` validates numeric bounds with inclusive/exclusive and integer
  options.
- Execution context can run in lightweight mode for signal and correlation
  propagation without frame tracking overhead.
- Resource composition can branch on the resolved Runner mode without reaching
  for `process.env` or `resources.runtime`.
- Standard ES decorators are now the default public path.
- Decorated class schemas now materialize actual class instances on parse.
- Silent subtree/local middleware deduplication is gone; conflicts now throw.
- Lazy resource initialisation is blocked once shutdown has started.
- Error IDs are shortened from `runner.errors.X.Y` to `X-Y` (breaking).
- `RuntimeCallSource.path` has been removed; use `source.id` (breaking).
- `RuntimeCallSourceKind.Middleware` is now split into `TaskMiddleware` and
  `ResourceMiddleware` (breaking).

---

## Breaking Changes

### Node.js 22+ Is Now Required

Runner 6.2 now requires **Node.js 22 or newer**.

- `package.json#engines.node` is now `>=22`.
- This affects local development, CI, and production deployments for the Node
  entrypoint.
- Browser, edge, and universal fetch-oriented surfaces remain available, but
  the published package contract now assumes a modern Node runtime for install
  and test tooling.

If you are upgrading from Runner 6.1 or earlier:

- Upgrade local Node versions, CI runners, and container base images to Node
  22+ before installing 6.2.
- Re-run dependency install after the Node upgrade so native and lockfile
  artifacts are resolved against the supported runtime.

This requirement is intentional for 6.2 because the runtime now leans on modern
Node facilities such as `process.getBuiltinModule(...)` in compatibility paths.

---

### Bun and Deno Resolution Is Now Explicit

Runner 6.2 now makes package resolution clearer for Bun and Deno:

- `@bluelibs/runner` resolves to the **universal** build by default in Bun and
  Deno.
- `@bluelibs/runner/node` remains the explicit **Node-compat** opt-in surface
  for Bun and Deno users who intentionally want the Node-flavoured APIs.

Why this changed:

- Deno satisfies both `deno` and `node` export conditions for npm packages.
- Bun also supports runtime-specific export conditions.
- Without explicit `bun` / `deno` conditions, those runtimes could drift toward
  the Node-conditioned root export even when the portable universal build was
  the safer default.

Practical guidance:

- Use `@bluelibs/runner` for portable application code, fetch-based remote
  clients, and the cross-runtime core surface.
- Use `@bluelibs/runner/node` only when you intentionally depend on Node-style
  capabilities such as smart HTTP clients, exposure servers, durable workflows,
  event lanes, or rpc lanes.
- Importing `./node` in Bun or Deno now clearly means "I want the Node-compat
  path", not "the root package happened to resolve there implicitly".

This does **not** claim that every `./node` feature is equally battle-tested in
Bun and Deno. It does make the entrypoint contract explicit and predictable.

---

### ES Decorators are the Default Public Import Path

Decorator-backed schemas and serializer DTOs now target standard ES decorators
from the main package entrypoint.

```ts
import { Match, Serializer } from "@bluelibs/runner";
```

If your project still uses legacy TypeScript decorators
(`experimentalDecorators`), import the compatibility surface instead:

```ts
import { Match, Serializer } from "@bluelibs/runner/decorators/legacy";
```

Key details:

- The legacy subpath still exposes the full `Match` helper surface, not only
  `Schema()` / `Field()`. Helpers such as `Match.ObjectIncluding(...)`,
  `Match.ArrayOf(...)`, `Match.fromSchema(...)`, and `check(...)` remain
  available there.
- Neither decorator mode requires `emitDecoratorMetadata` or
  `reflect-metadata`.
- The default `@bluelibs/runner` package now initializes `Symbol.metadata`
  when the runtime does not provide it yet, so the ES-decorator path works
  out of the box from the main import.
- Native/runtime-provided `Symbol.metadata` implementations are preserved;
  Runner only fills the gap when the symbol is absent.
- Legacy decorator support remains available for migration-sensitive projects,
  but the default public path now aligns with modern TypeScript decorator
  semantics.

Testing coverage now explicitly validates both modes:

- ES decorator syntax is exercised through the default test pipeline.
- Legacy decorator syntax is compiled in-test with
  `experimentalDecorators: true` to verify the compatibility entrypoint against
  real legacy decorator emit, not only manual decorator function calls.

---

### Subtree Middleware Conflicts Now Throw Instead of Silently Deduplicating

**Previously:** when a subtree middleware and a task-local (or resource-local)
middleware resolved to the same logical id, Runner silently dropped the subtree
middleware and kept the local one.

**Now:** Runner **throws a fast-fail error** (`subtreeMiddlewareConflict`)
instead of silently deduplicating. This prevents accidental override of
cross-cutting policies.

```ts
// Before: subtree + local middleware with same id -> local silently "won"
// After: this throws subtreeMiddlewareConflictError at compose time

subtreePolicy({
  middleware: [rateLimitTaskMiddleware.with({ windowMs: 1000, max: 10 })],
  register: [
    myTask.middleware([
      rateLimitTaskMiddleware.with({ windowMs: 500, max: 5 }),
    ]),
  ],
});
```

**Fix:** rename the local or subtree entry, or remove whichever one is
redundant.

**Also fixed in the same area:** middleware definitions that carry a
user-defined `use` field (for example fluent builder output with custom
properties) were incorrectly treated as conditional subtree entries. They are
now recognised as direct middleware attachments.

---

### Lazy Resources During Shutdown Now Throw

**Previously:** calling `runtime.getLazyResourceValue(resource)` while the
runtime was already tearing down could race against `dispose()`. The resource's
`ready()` hook might run after `dispose()` had already completed.

**Now:** any attempt to lazy-initialise a resource once shutdown has begun
(CoolingDown / Disposing / Drained / Disposed) throws the typed
`lazyResourceShutdownAccess` error immediately.

```ts
// Before: calling this during dispose() could silently race
const value = await runtime.getLazyResourceValue(heavyResource);

// After: throws lazyResourceShutdownAccessError if shutdown has begun
```

**Fix:** call `getLazyResourceValue()` before `runtime.dispose()` starts, or
handle the new error.

---

### Error IDs Shortened

All framework error IDs have been shortened from the verbose
`runner.errors.X.Y` format to a flat `X-Y` or camelCase format.

**Previously:**

```
runner.errors.http.baseUrlRequired
runner.errors.middleware.timeout
runner.errors.serializer.invalidPayload
runner.errors.lazyResourceSyncAccess
```

**Now:**

```
http-baseUrlRequired
middleware-timeout
serializer-invalidPayload
lazyResourceSyncAccess
```

**Fix:** update any code that matches on `error.id` strings to use the new
shortened format. The `RunnerErrorId` enum values have been updated accordingly.

---

### `RuntimeCallSource.path` Removed

**Previously:** `RuntimeCallSource` included an optional `path` field alongside
`kind` and `id`.

**Now:** the `path` field has been removed entirely. Only `kind` and `id`
remain.

```ts
// Before
type RuntimeCallSource = {
  kind: RuntimeCallSourceKind;
  id: string;
  path?: string; // ← REMOVED
};

// After
type RuntimeCallSource = {
  kind: RuntimeCallSourceKind;
  id: string;
};
```

**Fix:** replace `source.path` with `source.id`. The `runtimeSource.*()` factory
helpers no longer accept a `path` parameter.

---

### `RuntimeCallSourceKind.Middleware` Split into Task and Resource

**Previously:** task middleware and resource middleware shared a single
`"middleware"` source kind.

**Now:** they are distinguished:

| Old                                | New                                        |
| ---------------------------------- | ------------------------------------------ |
| `RuntimeCallSourceKind.Middleware` | `RuntimeCallSourceKind.TaskMiddleware`     |
|                                    | `RuntimeCallSourceKind.ResourceMiddleware` |
| `runtimeSource.middleware(id)`     | `runtimeSource.taskMiddleware(id)`         |
|                                    | `runtimeSource.resourceMiddleware(id)`     |

**Fix:** update source-kind comparisons and factory calls to use the granular
kind values.

---

## Feature Details

### Runtime Mode Access and Mode-Aware Resource Callbacks

Runner now exposes the resolved runtime mode as a first-class framework value.

From the outside, you can read it directly from the runtime handle:

```ts
const runtime = await r.run(app, { mode: "test" });

runtime.mode;
```

Inside the graph, depend on the new narrow built-in resource instead of the
broader runtime resource when you only need the mode:

```ts
.dependencies({
  mode: resources.mode,
})
```

Dynamic resource composition callbacks now receive the same resolved mode as a
required second argument:

```ts
r.resource({
  register: (config, mode) => {
    return mode === "test" ? [mockDb] : [realDb];
  },
  dependencies: (config, mode) => {
    return mode === "production"
      ? { logger: prodLogger }
      : { logger: devLogger };
  },
  subtree: (config, mode) => ({
    tags: [mode],
  }),
  isolate: (config, mode) => ({
    deny: mode === "test" ? ["system.*"] : [],
  }),
  overrides: (config, mode) => {
    return mode === "test" ? [r.override(realDb, testDb)] : [];
  },
});
```

Key details:

- `resources.mode` resolves to the bare `RunnerMode` string.
- The exposed value is the **effective resolved mode**, not just the raw user
  override.
- This gives subtree-restricted code a safe way to branch on mode without
  depending on `system.*` or `resources.runtime`.
- Existing single-argument callbacks such as `(config) => ...` remain valid.

---

### Decorated Class Schemas Hydrate on Parse

Decorated class schemas now materialize instances by default anywhere Runner
consumes schema parse results.

This affects:

- `Match.fromSchema(UserDto).parse(...)`
- `Match.compile({ user: Match.fromSchema(UserDto) }).parse(...)`
- Runner schema slots such as `.inputSchema(UserDto)`,
  `.configSchema(UserDto)`, and `.payloadSchema(UserDto)`
- `serializer.deserialize(..., { schema: UserDto })` and equivalent
  `Match.fromSchema(...)` serializer entry schemas

Example:

```ts
@Match.Schema()
class UserDto {
  @Match.Field(Match.NonEmptyString)
  id!: string;
}

const input = Match.fromSchema(UserDto).parse({ id: "u1" });

input instanceof UserDto; // true
```

Important details:

- Hydration walks recursive/self-referencing class schemas while preserving
  object identity.
- Existing instances of the same schema class now pass class-schema parsing as
  well, making parse idempotent for already-hydrated values.
- Hydration does **not** invoke class constructors during parse; Runner
  reattaches the class prototype onto validated data instead.

---

### Resource Override Object Form

Resource overrides now support a resource-only object form in addition to the
existing `init` function shorthand.

```ts
const mockDb = r.override(realDb, {
  context: () => ({ closed: false }),
  init: async () => new InMemoryDb(),
  dispose: async (db, _config, _deps, context) => {
    context.closed = true;
    await db.close();
  },
});
```

Supported keys:

- `context`
- `init`
- `ready`
- `cooldown`
- `dispose`

Key details:

- This object form is supported only when the base definition is a resource.
- The patch is partial but non-empty: you can override any subset of the
  supported lifecycle methods.
- Unspecified lifecycle hooks are inherited from the base resource.
- Provided `ready`, `cooldown`, or `dispose` hooks may be added even when the
  base resource did not define them.
- Overriding `context` changes the private lifecycle-state contract shared by
  `init()` / `ready()` / `cooldown()` / `dispose()`.
- Tasks, hooks, task middleware, and resource middleware keep the existing
  function-only override form.
- Invalid resource patch keys and non-function patch values now fail fast with
  explicit override errors.

This makes test harnesses and environment-specific infrastructure swaps easier
to express without changing resource identity, dependency wiring, or subtree
ownership.

---

### Tenant Async Context (`asyncContexts.tenant`)

A new built-in async context that propagates a `{ tenantId: string }` value
through the entire async call chain — tasks, events, hooks, and any user code
running inside them.

```ts
import { asyncContexts } from "@bluelibs/runner";

// Wrap an entire request in a tenant boundary
await asyncContexts.tenant.provide({ tenantId: "acme" }, async () => {
  await runtime.runTask(myTask); // tenantId flows through freely
});

// Read the active tenant anywhere in the call chain
const { tenantId } = asyncContexts.tenant.use();

// Safe probe — returns undefined when no tenant is active
const tenant = asyncContexts.tenant.tryUse();

// Guard a task: rejects with a typed error when no tenant context is present
const guardedTask = r
  .task("doWork")
  .middleware([asyncContexts.tenant.require()])
  .run(async () => {
    /* guaranteed: asyncContexts.tenant.use() works here */
  })
  .build();
```

Key design decisions:

- **Platform-adaptive** — on platforms without `AsyncLocalStorage` (e.g. plain
  browser) `provide(...)` is a no-op passthrough; `tryUse()` / `has()` return
  safe defaults. `use()` throws the typed `tenantContextRequired` error.
- **Validated at boundary** — the `tenantId` must be a non-empty string.
  Invalid payloads throw the typed `tenantInvalidContext` error immediately.
- **Nestable** — inner `provide(...)` calls shadow the outer tenant; the outer
  tenant is automatically restored when the inner scope exits.
- **`.require()` shorthand** — returns a ready-made `requireContext` task
  middleware that you can drop into a task's middleware list to enforce tenant
  context on every invocation of that task.

**New errors exported:**

| Error id                | When thrown                                                                      |
| ----------------------- | -------------------------------------------------------------------------------- |
| `tenantContextRequired` | `use()` or `tenantScope: "required"` middleware when no tenant context is active |
| `tenantInvalidContext`  | `provide(...)` called with an invalid `tenantId` (empty string, wrong shape)     |

---

### Tenant Scope for Built-in Middleware

The `cache`, `concurrency`, and `rateLimit` task middlewares now accept an
optional `tenantScope` configuration key that controls whether their internal
state is partitioned per tenant.

#### `tenantScope` modes

| Value                | Behaviour                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `"auto"` _(default)_ | Partition state per `tenantId` when tenant context is active; fall back to shared state when no tenant is present.   |
| `"required"`         | Require active tenant context. Throws `tenantContextRequired` when missing.                                          |
| `"off"`              | Disable partitioning entirely. All tenants share the same bucket. Use only when cross-tenant sharing is intentional. |

```ts
import {
  cacheMiddleware,
  concurrencyTaskMiddleware,
  rateLimitTaskMiddleware,
} from "@bluelibs/runner";

// Cache is siloed per tenant automatically
cacheMiddleware.with({ ttl: 5000, tenantScope: "auto" });

// Rate limit enforced per tenant; fails loudly if tenant is absent
rateLimitTaskMiddleware.with({
  windowMs: 60_000,
  max: 100,
  tenantScope: "required",
});

// Concurrency limit shared across all tenants (explicit opt-out)
concurrencyTaskMiddleware.with({ limit: 5, tenantScope: "off" });
```

**How it works internally:**

- `cache` and `rateLimit` prepend the `tenantId` to the cache/rate-limit key
  (`"tenantId:baseKey"`).
- `concurrency` stores one `Semaphore` per `(config, tenantId)` pair so each
  tenant gets its own concurrency slot without sharing limits with other
  tenants.

**New types exported:** `TenantScopeMode`, `TenantScopeConfig`

---

### `IAsyncContext` gets `tryUse()` and `has()`

The `IAsyncContext<T>` interface now officially includes:

```ts
tryUse(): T | undefined   // safe probe — never throws
has(): boolean            // convenience check
```

Both are also available on `asyncContexts.execution` and the new
`asyncContexts.tenant` accessor.

---

### Validation Ergonomics: `Match.WithMessage`, Parent-Aware `Match.Where`, Recursive `Match.fromSchema`, and `errors.matchError`

Runner's validation layer now supports more expressive domain errors without
changing the core match-validation error contract.

#### Validation `errorPolicy` and `Match.WithErrorPolicy(...)`

Validation aggregation is now framed as an explicit policy:

- `errorPolicy: "first"` keeps fail-fast behaviour
- `errorPolicy: "all"` collects all failures, then throws one aggregate
  `errors.matchError`

Preferred APIs:

```ts
check(input, schema, { errorPolicy: "all" });
check(input, Match.WithErrorPolicy(schema, "all"));

@Match.Schema({ errorPolicy: "all" })
class CreateUserInput {}
```

Compatibility notes:

- `throwAllErrors` still works as a deprecated alias
- `throwAllErrors: true` maps to `errorPolicy: "all"`
- `throwAllErrors: false` maps to `errorPolicy: "first"`
- explicit `check(..., { errorPolicy })` takes precedence over deprecated
  alias usage

#### `Match.WithMessage(pattern, messageOrFormatter)`

Wrap any pattern and override only the top-level match-validation error message while
preserving `id`, `path`, and `failures`. The wrapper now takes the message input directly.

```ts
check(
  { email: "nope" },
  {
    email: Match.WithMessage(
      Match.Email,
      ({ value, path }) => `Invalid email ${String(value)} at ${path}`,
    ),
  },
);
```

Key details:

- Works in plain `check(...)` and inside decorator-backed schemas.
- `messageOrFormatter` accepts:
  - a static string
  - `{ message, code?, params? }`
  - a callback `(ctx) => string | { message, code?, params? }`
- Callback context is `{ value, error, path, pattern, parent? }`.
- When `code` / `params` are provided, Runner copies that metadata onto the
  owned `failures[]` entries without rewriting each leaf failure's raw
  `message`.
- In aggregate validation mode (`errorPolicy: "all"` / deprecated
  `throwAllErrors: true`), the first failing `Match.WithMessage(...)` still
  controls the top-level error message.
- JSON Schema export stays unchanged; `Match.WithMessage(...)` compiles to the
  wrapped inner pattern.

#### `Match.Where((value, parent?) => ...)`

Custom predicates now receive the immediate parent container when validation is
happening inside an object, map, or array element.

```ts
const matchesUserEmail = Match.Where(
  (value: unknown, parent?: unknown): value is string =>
    typeof value === "string" &&
    typeof (parent as { userId?: string } | undefined)?.userId === "string",
);
```

This makes cross-field sync validation practical without polluting the thrown
match-validation error shape with parent payload data.

#### Recursive class schemas via `Match.fromSchema(() => Class)`

Decorator-backed schemas can now point at themselves, or at classes declared
later, without forcing eager resolution.

```ts
@Match.Schema()
class User {
  @Match.Field(Match.NonEmptyString)
  name!: string;

  @Match.Field(Match.Integer)
  age!: number;

  @Match.Field(Match.fromSchema(() => User))
  self!: User;

  @Match.Field(Match.ArrayOf(Match.fromSchema(() => User)))
  children!: User[];
}
```

Key details:

- Use resolver form `Match.fromSchema(() => User)` inside decorated fields when
  the target class is self-referencing or declared later in the file.
- Existing `Match.fromSchema(User)` behaviour is unchanged for non-recursive
  references.
- JSON Schema export preserves recursive graphs via `$defs` / `$ref`.

#### Manual second-pass validation with `errors.matchError`

After a structural `check(...)` pass, you can raise a targeted validation
failure on an exact field path by throwing `errors.matchError.new(...)`.

```ts
import { errors, Match, check } from "@bluelibs/runner";

const input = check({ email: "ada@example.com" }, { email: Match.Email });

if (!isEmailUnique(input.email)) {
  throw errors.matchError.new({
    path: "$.email",
    failures: [
      {
        path: "$.email",
        expected: "unique email",
        actualType: "string",
        message: "Email already exists.",
      },
    ],
  });
}
```

Path notes:

- `"$"` means the root value being validated.
- `$.email` means the `email` field on the root object.
- `$.users[2].email` means the `email` field of the third `users` element.

---

### `Match.Range` for Numeric Bounds Validation

A new validation primitive for checking numeric ranges with optional bounds,
inclusivity, and integer constraints.

```ts
import { Match, check } from "@bluelibs/runner";

// Basic inclusive range (default)
const percentage = check(50, Match.Range({ min: 0, max: 100 }));

// Exclusive bounds (open interval)
const probability = check(
  0.5,
  Match.Range({ min: 0, max: 1, inclusive: false }),
);

// Integer-only range
const diceRoll = check(4, Match.Range({ min: 1, max: 6, integer: true }));

// One-sided bounds
const positive = check(42, Match.Range({ min: 0 }));
const capped = check(99, Match.Range({ max: 100 }));
```

Options:

- `min` — lower bound (optional; at least one of `min` / `max` required)
- `max` — upper bound (optional; at least one of `min` / `max` required)
- `inclusive` — defaults to `true`; when `false`, both bounds are exclusive
- `integer` — when `true`, restricts validation to integers only

JSON Schema export compiles to `minimum` / `maximum` (inclusive) or
`exclusiveMinimum` / `exclusiveMaximum` (exclusive), with `"type": "integer"`
when the `integer` option is set.

---

### Abort Signal Propagation

Runner 6.2 introduces cooperative cancellation through the standard
`AbortSignal` API. Signals flow through the execution context, task runner,
event manager, and built-in middleware.

#### Signals in Tasks

Tasks receive an optional `signal` through the `TaskRunContext`:

```ts
const myTask = r
  .task("processData")
  .run(async (input, { signal }) => {
    signal?.throwIfAborted();
    // ... long-running work ...
  })
  .build();

// Pass a signal when running
const controller = new AbortController();
await runtime.runTask(myTask, input, { signal: controller.signal });
```

#### Signals in Events

Event emissions now accept an optional `signal` field:

```ts
await runtime.emitEvent(myEvent, payload, { signal: controller.signal });
```

The signal is available on the emission object inside handlers:

```ts
emission.signal?.throwIfAborted();
```

#### Signal Inheritance Through Execution Context

When execution context is enabled, signals seed into the execution tree and
propagate to nested task runs and event emissions automatically. The first
signal attached to a top-level execution becomes the ambient signal for all
descendant operations.

```ts
await asyncContexts.execution.provide(
  { signal: controller.signal },
  async () => {
    // All nested runTask / emitEvent calls inherit this signal
    await runtime.runTask(nestedTask);
  },
);
```

#### `raceWithAbortSignal` Internal Utility

An internal utility that races a promise against an abort signal, rejecting with
`cancellationError` if the signal fires first. Used internally by the task
runner and middleware — not currently part of the public surface.

Key details:

- Signals are optional everywhere — omitting them preserves existing behavior.
- The `cancellationError` typed error is thrown when a signal-based
  cancellation triggers.
- The timeout middleware creates an internal `AbortController` and propagates
  its signal down the middleware chain.

---

### Execution Context Lightweight Mode (`frames: "off"`)

The execution context now supports a lightweight mode that propagates
`correlationId` and `signal` inheritance without tracking full frame stacks.

```ts
await r.run(app, {
  executionContext: {
    frames: "off",
  },
});
```

Key details:

- `frames: "full"` (default when enabled) — full frame stack tracking with
  cycle detection.
- `frames: "off"` — no frame tracking, no cycle detection; only correlationId
  and signal propagation.
- When `frames: "off"`, `cycleDetection` must be `false` (validated at
  configuration time).
- The execution context snapshot discriminates on `framesMode`:
  - `FullExecutionContextSnapshot` (`framesMode: "full"`) includes `frames`,
    `depth`, and `currentFrame`.
  - `LightExecutionContextSnapshot` (`framesMode: "off"`) includes only
    `correlationId`, `startedAt`, and `signal`.

This is useful for production workloads that need signal cancellation and
correlation tracking but want to avoid the overhead of full frame tracking.

---

### Event Lanes Async Context Allowlist

Event lanes now support an explicit allowlist for async contexts that propagate
through lane relay:

```ts
const lane = r
  .eventLane("app.lanes.events")
  .asyncContexts([tenantContext, "other-context-id"])
  .build();
```

Key details:

- Legacy `allowAsyncContext: true` still works as an implicit allow-all.
- New explicit allowlist is recommended for security and control.
- Events routed through lanes only carry async context values in the allowlist.
- Unlisted contexts are silently stripped during relay.

---

### Override Duplicate Targets Allowed in Test Mode

**Previously:** registering multiple overrides for the same target always threw
`overrideDuplicateTarget`.

**Now:** in test mode (`RunnerMode.TEST`), ambiguous duplicate override targets
are resolved instead of throwing. This makes it easier to compose test fixtures
that independently override the same dependency.

Production mode behavior is unchanged — duplicate targets still throw.

---

### Cache Middleware Provider Architecture

The cache middleware has been restructured around a configurable provider
pattern:

```ts
import { cacheResource } from "@bluelibs/runner";

cacheResource.with({
  provider: myCacheProvider,
  defaultOptions: { ttl: 5000, max: 1000 },
  totalBudgetBytes: 50 * 1024 * 1024,
});
```

Key changes:

- `cacheProviderResource` creates the default in-memory LRU provider.
- `cacheResource` manages per-task cache instances using the provider.
- `cacheMiddleware` wraps tasks and checks/updates cache through the provider.
- The provider is pluggable — implement the `CacheProvider` interface for Redis,
  Memcached, etc.
- Default behavior (in-memory LRU) remains unchanged when no custom provider is
  configured.

---

## Change Details

### Bug Fixes

#### `execution.provide()` / `execution.record()` Fail Fast on Missing Callback

**Previously:** calling `asyncContexts.execution.provide(options)` or
`asyncContexts.execution.record(options)` without the required callback
argument `fn` would crash with a cryptic runtime error deep inside the
implementation.

**Now:** both overloads check that the callback is present and throw the typed
`contextError` immediately with a descriptive message:

```
Execution context callback is required when calling asyncContexts.execution.provide(options, fn).
```

---

#### `execution.provide()` / `execution.record()` Throw When AsyncLocalStorage Is Unavailable

**Previously:** calling `asyncContexts.execution.provide(...)` or
`asyncContexts.execution.record(...)` on platforms without `AsyncLocalStorage`
would silently skip context propagation and simply execute the callback.

**Now:** both functions throw the typed `contextError` immediately with a clear
message when the underlying `AsyncLocalStorage` is unavailable, instead of
silently degrading.

---

#### `asyncContexts.tenant.has()` Is Now a Pure Presence Probe

**Previously:** `has()` was implemented as `tryUse() !== undefined`, meaning it
returned `false` when the tenant store held an _invalid_ value (e.g.
`{ tenantId: "" }`). This conflated presence with validity.

**Now:** `has()` delegates directly to the underlying `IAsyncContext.has()`,
returning `true` whenever a value is stored — regardless of whether it passes
validation. `tryUse()` still validates and throws on invalid payloads. This
keeps the two methods semantically distinct and avoids surprising `false`
returns in edge cases.

---

#### `rateLimitTaskMiddleware` Rejects Zero for `windowMs` / `max`

**Previously:** the validation pattern for `windowMs` and `max` was
`Match.PositiveInteger`, which could accept `0` depending on the pattern
implementation.

**Now:** both fields use an explicit `value > 0` guard, so `0` is rejected at
configuration time with a `validationError`.

---

#### Shutdown Budgets No Longer Detach `cooldown()` or Final Disposal

**Previously:** `dispose.totalBudgetMs` could cause `cooldown()`, lifecycle
events, or final resource disposal to continue in the background after the
runtime had already advanced to later shutdown phases.

**Now:** Runner fully awaits `cooldown()`, `events.disposing`,
`events.drained`, and final resource disposal in strict order. Shutdown budgets
now cap only the bounded waits inside shutdown: the optional
`cooldownWindowMs` and the drain wait derived from `drainingBudgetMs`. Time
spent in `cooldown()` still reduces the remaining `totalBudgetMs`, but
`cooldown()` itself is not detached or cut off early.

---

#### `resources.queue` Uses Teardown Mode During Runtime Disposal

**Previously:** the built-in queue resource fire-and-forgot queue disposal
during runtime shutdown, so queue-backed work could still be winding down after
the resource had been disposed.

**Now:** `resources.queue` awaits `queue.dispose({ cancel: true })` for every
tracked queue during runtime teardown. Active queue tasks receive the
cooperative abort signal, queued-but-not-started work is rejected, and teardown
failures now surface instead of being silently ignored.

---

### Documentation

The guide has been substantially restructured in this release:

- `06-advanced.md` replaced by `06-meta-and-internals.md` with focused
  coverage of framework internals, the store model, and extension points.
- `02c-events-hooks.md` renamed to `02c-events-and-hooks.md`.
- New `04c-multi-tenant.md` guide unit covering the tenant async context and
  tenant scope middleware.
- Expanded content across resources, tasks, middleware, tags, runtime
  lifecycle, serialization/validation, observability, and testing chapters.
- `readmes/AI.md` updated to reflect the new tenant context, async context
  additions, abort signal support, and Match.Range.
- Validation docs now cover `Match.WithMessage(...)`, parent-aware
  `Match.Where(...)`, `Match.Range(...)`, manual `errors.matchError` follow-up
  validation, and the path contract for root/object/array failures.
- Decorator docs now clarify the ES-by-default split, the
  `@bluelibs/runner/decorators/legacy` compatibility import, and the
  `Symbol.metadata` runtime requirement for ES decorators.
- Runtime docs now clarify how to access the resolved mode through
  `runtime.mode`, `resources.mode`, and mode-aware resource callbacks.
- AWS Lambda quickstart example updated with request context handling and
  improved handler patterns.

---

### Internal Refactors

#### Framework Root Renamed to Synthetic Framework Root

The internal `createFrameworkRootGateway` function and its associated constant
`FRAMEWORK_ROOT_RESOURCE_ID` have been renamed to `createSyntheticFrameworkRoot`
and `SYNTHETIC_FRAMEWORK_ROOT_RESOURCE_ID`.

The refactor also introduces two named namespace resource ids that make the
internal tree easier to inspect:

| Id       | Contents                                                                    |
| -------- | --------------------------------------------------------------------------- |
| `runner` | Runner-layer framework items (async contexts, middleware helpers, debug, …) |
| `system` | System-layer framework items                                                |

#### `markFrameworkDefinition` Removed

The internal `markFrameworkDefinition()` / `isFrameworkDefinitionMarked()`
helpers and the backing `symbolFrameworkDefinition` symbol have been deleted.
The synthetic framework root is now the only internal "hack" in the build
system — framework definitions no longer carry a hidden symbol brand.

#### `asyncContexts.ts` Slimmed Down

The module is now a thin re-export barrel. All implementation has moved into
`src/async-contexts/` — one file per context (`execution.asyncContext.ts`,
`tenant.asyncContext.ts`).

#### `getSubtreeMiddlewareDuplicateKey` Exported

This internal helper was previously a private function. It is now exported from
`src/tools/subtreeMiddleware` so that `MiddlewareResolver` and any future
resolution code can call it without re-implementing the logic.

#### `RegisterableItems` → `RegisterableItem`

The plural type `RegisterableItems` has been renamed to the singular
`RegisterableItem`. A backward-compatible alias is preserved so existing
imports continue to work:

```ts
export type { RegisterableItem, RegisterableItem as RegisterableItems };
```

#### `runtimeMetadata.ts` Removed

The internal `runtimeMetadata.ts` module (including `getRuntimeId`) was deleted.
Runtime id resolution now goes through `StoreLookup` and
`resolveRequestedIdFromStore()` helpers, which unify definition-to-id lookups
across the codebase.

#### Cache Middleware Restructured

The cache middleware internals were restructured into three files:

- `cache.middleware.ts` — the task middleware wrapper
- `cache.resource.ts` — the resource managing per-task cache instances
- `cache.shared.ts` — shared types and the cache provider contract

This decouples the provider pattern from the middleware logic and enables
pluggable cache backends (e.g. Redis).

#### Event Lanes Controller Decomposed

`EventLanesController` was refactored with logic extracted into focused modules:

- `eventLanes.producer.ts` — producer interceptor registration
- `eventLanes.consumer.ts` — consumer queue message handling
- `eventLanes.relayInterceptors.ts` — relay interceptor wiring

#### Event Manager API Simplified

The `EventManager.emit()` method now takes a unified `EventEmissionRequest`
argument instead of separate `source` and `options` parameters. The internal
`bindStore()` coupling has been removed — the event manager no longer holds a
direct reference to the store.

---

### Test Coverage

All new functionality ships with full test coverage:

- `run.dynamic-register-and-dependencies.test.ts`,
  `run.overrides.test.ts`, `resource.builder.test.ts`,
  `resource.subtree.builder.test.ts`, `Store.registerGlobals.test.ts`, and
  associated type tests — coverage for `resources.mode` and mode-aware
  `register(...)`, `dependencies(...)`, `isolate(...)`, `subtree(...)`, and
  `overrides(...)` callbacks
- `system.tenantContext.test.ts` — tenant context lifecycle, nesting, guards,
  cross-platform degradation; added edge-case for `has()` with an invalid
  stored value
- `tenantScope.middleware.test.ts` — cache / concurrency / rate-limit
  tenant-scoped partitioning (338-line test suite)
- `run.lazy-init-mode.test.ts` — race-condition test: in-flight lazy init
  blocked when dispose races with `releaseInit()`
- `RunResult.test.ts` — unit test for shutdown-phase guard
- `DependencyProcessor.lazy-shutdown.regression.test.ts` — regression coverage
  for the DependencyProcessor shutdown path
- `rateLimit.middleware.test.ts` — added validation coverage for `windowMs`/`max` = `0`
- `system.executionContext.test.ts` — added tests for missing-callback fast-fail
  in both `provide()` and `record()`
- `fluent-dependency-chain.type-test.ts` — type-level tests verifying the
  fluent `.dependencies()` chain types remain sound
- `tenant-scope.type-test.ts` — type-level tests for the new tenant scope API
- `context.test.ts`, `subtreeMiddleware.test.ts`, `MiddlewareManager.test.ts`
  — updated to reflect conflict-detection-throws semantics
- `check.decorators.test.ts`, `check.test.ts`, `check.schema.test.ts`,
  `check.to-json-schema.test.ts`, `schema.decorator-shorthand.test.ts`, and
  `Serializer.test.ts` — coverage for `Match.WithMessage(...)`, parent-aware
  `Match.Where(...)`, `Match.Range(...)`, nested/custom message propagation,
  and runtime-only JSON Schema behavior
- `default-es-decorators.test.ts`, `legacy-decorator-transpile.test.ts`, and
  `decorator-entrypoints.test.ts` — explicit coverage for the ES-default and
  legacy-compat decorator entrypoints
- `check.type-test.ts` — type-level coverage for `Match.WithMessage(...)`
  inference
- `run.execution-context.signal-inheritance.test.ts` — abort signal inheritance
  across nested task runs and event emissions
- `ExecutionContextStore.signal.test.ts` — unit tests for `runWithSignal()`,
  `resolveSignal()`, and lightweight framesMode
- `OverrideManager.cycle.regression.test.ts` — regression coverage for
  duplicate override target handling in test mode
- `package.exports.runtime-conditions.test.ts` — validates Bun and Deno export
  conditions resolve to the correct entrypoints
- `platform.env.test.ts` — environment variable reader for Deno-compatible
  `env.get()` calls
- `cache.middleware.coverage.test.ts`, `cache.middleware.stable-task-id.coverage.test.ts`
  — coverage for the restructured cache provider architecture
- `StoreLookup.coverage.test.ts`, `Store.lookup-fallback.coverage.test.ts` —
  coverage for the new StoreLookup helper

---

## Documentation Follow-Ups

- [ ] Run a dedicated subagent review that checks public-surface JSDoc against `readmes/AI.md`, composed guides, and Typedoc output so API comments stay aligned with the documented contracts.
- [ ] Document `Match.Range` in the serialization/validation guide unit.
- [ ] Document abort signal propagation across tasks, events, and middleware in
      the runtime lifecycle guide.
- [ ] Document execution context lightweight mode (`frames: "off"`) in the observability chapter.
- [ ] Update error reference documentation to reflect the new shortened error ID format.
- [ ] Document the event lanes async context allowlist in the remote lanes guide.
