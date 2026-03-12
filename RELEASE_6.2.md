# Runner 6.2 Release Notes

## Overview

6.2 introduces first-class **multi-tenant support** as a cross-cutting concern
for the entire middleware layer, adds a dedicated **tenant async context** that
works alongside the existing execution context, closes a long-standing
**lazy-resource wakeup race** during shutdown, hardens **subtree-vs-local
middleware conflict detection**, and ships a set of internal refactors that
make the framework root structure clearer and easier to reason about.

---

## New Features

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

| Error id                              | When thrown                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `runner.errors.tenantContextRequired` | `use()` or `tenantScope: "required"` middleware when no tenant context is active |
| `runner.errors.tenantInvalidContext`  | `provide(...)` called with an invalid `tenantId` (empty string, wrong shape)     |

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

#### `Match.WithMessage(pattern, { error })`

Wrap any pattern and override only the top-level match-validation error message while
preserving `id`, `path`, and `failures`.

```ts
check(
  { email: "nope" },
  {
    email: Match.WithMessage(Match.Email, {
      error: ({ value, path }) => `Invalid email ${String(value)} at ${path}`,
    }),
  },
);
```

Key details:

- Works in plain `check(...)` and inside decorator-backed schemas.
- `error` accepts either a static string or a callback.
- Callback context is `{ value, error, path, pattern, parent? }`.
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

## Bug Fixes

### `execution.provide()` / `execution.record()` Fail Fast on Missing Callback

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

### `asyncContexts.tenant.has()` Is Now a Pure Presence Probe

**Previously:** `has()` was implemented as `tryUse() !== undefined`, meaning it
returned `false` when the tenant store held an _invalid_ value (e.g.
`{ tenantId: "" }`). This conflated presence with validity.

**Now:** `has()` delegates directly to the underlying `IAsyncContext.has()`,
returning `true` whenever a value is stored — regardless of whether it passes
validation. `tryUse()` still validates and throws on invalid payloads. This
keeps the two methods semantically distinct and avoids surprising `false`
returns in edge cases.

---

### `rateLimitTaskMiddleware` Rejects Zero for `windowMs` / `max`

**Previously:** the validation pattern for `windowMs` and `max` was
`Match.PositiveInteger`, which could accept `0` depending on the pattern
implementation.

**Now:** both fields use an explicit `value > 0` guard, so `0` is rejected at
configuration time with a `validationError`.

---

### Lazy Resource Wakeup Blocked During Shutdown

**Previously:** calling `runtime.getLazyResourceValue(resource)` (or any code
path that triggers lazy initialisation) while the runtime was already tearing
down could race against `dispose()`. The resource's `ready()` hook might be
called after `dispose()` had already run, leading to undefined behaviour.

**Now:** any attempt to lazy-initialise a resource once shutdown has begun
(CoolingDown / Disposing / Drained / Disposed phases) throws the new typed
error immediately, both at the `RunResult` boundary and inside
`DependencyProcessor`.

```
runner.errors.lazyResourceShutdownAccess
Resource "my-resource" cannot be lazy-initialized because shutdown has already started.
```

The fix covers two race variants:

1. The caller tries to call `getLazyResourceValue()` after `dispose()` is
   called — blocked at the `RunResult` level.
2. An in-flight lazy init completes after `dispose()` is called — blocked
   inside `DependencyProcessor` before `readyResource()` is reached, so
   `ready()` is never invoked in a torn-down context.

---

### Subtree Middleware Conflict Detection (Breaking Behaviour Change)

**Previously:** when a subtree middleware and a task-local (or resource-local)
middleware resolved to the same logical id, Runner silently dropped the subtree
middleware and kept the local one.

**Now:** Runner **throws a fast-fail error** (`subtreeMiddlewareConflict`)
instead of silently deduplicating. This prevents accidental override of
cross-cutting policies.

```
runner.errors.subtreeMiddlewareConflict
Subtree middleware "rate-limit" conflicts with a task-local middleware using the same id.
Remediation: Remove either the subtree middleware or the task-local middleware for "rate-limit".
```

If you relied on local middleware intentionally overriding subtree middleware,
you need to either rename one of them or remove the duplicate.

**Also fixed in the same area:** middleware definitions that carry a user-defined
`use` field (e.g. fluent builder output with custom properties) were
incorrectly treated as conditional subtree entries. They are now recognised as
direct middleware attachments.

---

## Documentation

The guide has been substantially restructured in this release:

- `06-advanced.md` replaced by `06-meta-and-internals.md` with focused
  coverage of framework internals, the store model, and extension points.
- `02c-events-hooks.md` renamed to `02c-events-and-hooks.md`.
- Expanded content across resources, tasks, middleware, tags, runtime
  lifecycle, serialization/validation, observability, and testing chapters.
- `readmes/AI.md` updated to reflect the new tenant context and async context
  additions.
- Validation docs now cover `Match.WithMessage(...)`, parent-aware
  `Match.Where(...)`, manual `errors.matchError` follow-up validation, and the path
  contract for root/object/array failures.

---

## Internal Refactors

### Framework Root Renamed to Synthetic Framework Root

The internal `createFrameworkRootGateway` function and its associated constant
`FRAMEWORK_ROOT_RESOURCE_ID` have been renamed to `createSyntheticFrameworkRoot`
and `SYNTHETIC_FRAMEWORK_ROOT_RESOURCE_ID`. The old name is still exported as
an alias for backwards compatibility.

The refactor also introduces two named namespace resource ids that make the
internal tree easier to inspect:

| Id       | Contents                                                                    |
| -------- | --------------------------------------------------------------------------- |
| `runner` | Runner-layer framework items (async contexts, middleware helpers, debug, …) |
| `system` | System-layer framework items                                                |

### `asyncContexts.ts` Slimmed Down

The module is now a thin re-export barrel. All implementation has moved into
`src/async-contexts/` — one file per context (`execution.asyncContext.ts`,
`tenant.asyncContext.ts`).

### `getSubtreeMiddlewareDuplicateKey` Exported

This internal helper was previously a private function. It is now exported from
`src/tools/subtreeMiddleware` so that `MiddlewareResolver` and any future
resolution code can call it without re-implementing the logic.

---

## Test Coverage

All new functionality ships with full test coverage:

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
  `Match.Where(...)`, nested/custom message propagation, and runtime-only JSON
  Schema behavior
- `check.type-test.ts` — type-level coverage for `Match.WithMessage(...)`
  inference

---

## Migration Guide

### Silent middleware deduplication is gone

```ts
// Before: subtree + local middleware with same id → local silently "won"
// After: this throws subtreeMiddlewareConflictError at compose time

subtreePolicy({
  middleware: [rateLimitTaskMiddleware.with({ windowMs: 1000, max: 10 })],
  register: [
    myTask.middleware([
      rateLimitTaskMiddleware.with({ windowMs: 500, max: 5 }),
    ]),
    // ↑ same logical id as the subtree one → throws in 6.2
  ],
});
```

**Fix:** rename the local or subtree entry, or remove whichever one is
redundant.

### Lazy resources during shutdown now throw

```ts
// Before: calling this during dispose() could silently race
const value = await runtime.getLazyResourceValue(heavyResource);

// After: throws lazyResourceShutdownAccessError if shutdown has begun
```

**Fix:** call `getLazyResourceValue()` before `runtime.dispose()` starts, or
handle the new error.
