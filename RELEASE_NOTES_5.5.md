# Release Notes — v5.5

> Branch `feat/5.5` relative to `5.4.0` (tag `5.4.0` / `origin/main`).
> 524 files changed, 28 542 insertions, 12 084 deletions.

---

## Breaking Changes

### `durable.execute()` / `executeStrict()` deprecated → `startAndWait()` (or `start()` + `wait()`)

`execute()` and `executeStrict()` are now deprecated compatibility APIs. Migrate to `startAndWait()`, which returns an envelope:

```ts
// Before
const result = await durable.execute(task, input);

// After
const {
  data: result,
  durable: { executionId },
} = await durable.startAndWait(task, input);
```

`startExecution()` is also deprecated in favor of `start()`.

### `serializer.addType` loses the legacy `(name, factory)` overload

Only the `(typeDef: TypeDefinition<TInstance, TSerialized>)` overload remains. Update any callers that used the two-argument form.

### Phantom tasks throw when not routed through a tunnel

Calling a phantom task directly (not via tunnel middleware) now throws instead of silently doing nothing.

### `http-fetch-tunnel.resource` removed from public barrel

Previously re-exported from `@bluelibs/runner`. Move your imports to the node-specific entry point.

---

## New Features

### Error Helpers — `new()`, `create()`, `httpCode`, `remediation`

Error helpers gained two construction methods that build a typed `RunnerError` **without** throwing:

```ts
// Construct without throwing
const err = AppError.new({ code: 400, message: "Bad input" });
const err2 = AppError.create({ code: 400, message: "Bad input" }); // alias

// Throw as before
AppError.throw({ code: 400, message: "Bad input" });
```

Two new builder methods on `r.error(id)`:

```ts
const AppError = r
  .error<{ code: number; message: string }>("app.errors.AppError")
  .httpCode(400) // sets error.httpCode
  .remediation("Check the request payload and retry.") // appended to error.message
  .build();

AppError.httpCode; // 400 — accessible on the helper too
```

`data` is now optional when all keys of `TData` are optional (`ErrorThrowArgs` type).

### `r.error.is()` — generic Runner error type guard

Check whether an arbitrary `unknown` value is **any** Runner error without knowing which specific helper created it:

```ts
import { r } from "@bluelibs/runner";

catch (err) {
  if (r.error.is(err)) {
    // err is narrowed to RunnerError — has .id, .data, .httpCode, .remediation
    console.error(`Runner error: ${err.id}`);
  }
  // Partial data match:
  if (r.error.is(err, { code: 400 })) { ... }
}
```

### `store.getAllThrows()` — full dependency-chain error introspection

```ts
const allErrorIds = runtime.store.getAllThrows(myTask);
// Returns readonly string[] — deduplicated error ids from:
//   own throws + local middleware + everywhere middleware +
//   all resource dependency throws + hook throws for events emitted
```

Also available as the standalone `getAllThrows(registry, target)` helper.

### Lazy Resource Initialization

Pass `lazy: true` to `run()` to defer initialization of resources not needed at bootstrap. Load them on-demand via the new async accessor:

```ts
const runtime = await run(root, { lazy: true });

// Deferred — initializes only when called
const value = await runtime.getLazyResourceValue(myHeavyResource);

// Calling synchronous getResourceValue on an uninitialized lazy resource throws
// lazyResourceSyncAccessError
```

`getLazyResourceValue` is only available when `lazy: true` is set.

### Parallel Resource Initialization

```ts
const runtime = await run(root, { initMode: "parallel" });
// or
const runtime = await run(root, { initMode: ResourceInitMode.Parallel });
```

All resources whose dependencies are already ready start their `init()` concurrently instead of one-by-one. Sequential is still the default; string literal values `"sequential"` / `"parallel"` work without importing the enum.

### New `RunResult` methods

| Method                           | Description                                             |
| -------------------------------- | ------------------------------------------------------- |
| `getLazyResourceValue(resource)` | On-demand async resource loader (requires `lazy: true`) |
| `getRootId()`                    | Returns the root resource's id                          |
| `getRootConfig<C>()`             | Returns the root resource's config object               |
| `getRootValue<V>()`              | Returns the root resource's initialized value           |

`dispose()` is now idempotent (second call is a no-op). Calling it during bootstrap throws `runResultDisposeDuringBootstrapError`.

### `r.override(base, fn)` shorthand

`r.override` now supports a typed shorthand for the most common override case:

```ts
// Resource: replaces init
const mockMailer = r.override(realMailer, async () => new MockMailer());

// Task / Hook / Middleware: replaces run
const fastTask = r.override(slowTask, async (input, deps) => {
  return "fast";
});
```

- `r.override(base, fn)` returns a definition with the same `id` and replaced behavior.
- Resource base: `fn` maps to `init`.
- Task, hook, task middleware, resource middleware base: `fn` maps to `run`.
- `r.override(base)` fluent builder remains available for multi-property overrides.

### Event Emission — `failureMode`, `throwOnError`, `report`

Event emitters (injected or `runtime.emitEvent`) now accept options:

```ts
await myEvent(payload, {
  failureMode: "aggregate", // "fail-fast" (default) | "aggregate"
  throwOnError: false, // suppress throws
  report: true, // return IEventEmitReport instead of void
});

const report = await runtime.emitEvent(myEvent, payload, { report: true });
// report.totalListeners, .succeededListeners, .failedListeners, .errors, etc.
```

`IEventEmitReport`:

```ts
interface IEventEmitReport {
  totalListeners: number;
  attemptedListeners: number;
  skippedListeners: number;
  succeededListeners: number;
  failedListeners: number;
  propagationStopped: boolean;
  errors: IEventListenerError[];
}
```

When `failureMode: "aggregate"` and multiple listeners throw, a structured `AggregateError`-shaped error is raised with an `.errors` array.

### Parallel Event Listeners

Opt in per-event by setting `parallel: true` on the event definition:

```ts
const tick = r.event("app.events.tick").parallel(true).build();
```

Listeners with the same `.order` priority run concurrently within a batch. Batches execute sequentially. Propagation stopping is only checked between batches, not mid-batch.

### ExecutionJournal — typed per-execution state

Middleware and tasks can now share state safely through a typed key-value store scoped to a single task execution:

```ts
import { journal, globals } from "@bluelibs/runner";

// Create a custom key
const startedAtKey = journal.createKey<{ at: Date }>("app.middleware.timing");

// In middleware
const timing = r.middleware
  .task("app.middleware.timing")
  .run(async ({ task, next, journal }) => {
    journal.set(startedAtKey, { at: new Date() });
    const result = await next(task.input);
    return result;
  })
  .build();

// In task
const myTask = r
  .task("app.tasks.myTask")
  .run(async (input, deps, { journal }) => {
    const { at } = journal.get(startedAtKey) ?? {};
    return "done";
  })
  .build();
```

Calling `set()` on an existing key throws a typed `journalDuplicateKeyError`. Pass `{ override: true }` to update intentionally.

**Built-in middleware journal keys** (via `globals.middlewares.task.<name>.journalKeys`):

| Middleware       | Key               | Type                  |
| ---------------- | ----------------- | --------------------- |
| `cache`          | `hit`             | `boolean`             |
| `retry`          | `attempt`         | `number`              |
| `retry`          | `lastError`       | `Error`               |
| `timeout`        | `abortController` | `AbortController`     |
| `circuitBreaker` | `state`           | `CircuitBreakerState` |
| `circuitBreaker` | `failures`        | `number`              |
| `fallback`       | `active`          | `boolean`             |
| `fallback`       | `error`           | `Error`               |
| `rateLimit`      | `remaining`       | `number`              |
| `rateLimit`      | `resetTime`       | `number`              |

### Tagged Task/Resource Type Helpers

Two new types that carry tag contracts through `store.getTasksWithTag()`:

```ts
import { TaggedTask, TaggedResource } from "@bluelibs/runner";

const tasks = store.getTasksWithTag(httpRouteTag);
// tasks: TaggedTask<typeof httpRouteTag>[]
// — input type is inferred from the tag's contracts, not unknown/any
```

### `LockableMap<K, V>`

A `Map` subclass that can be permanently frozen:

```ts
import { LockableMap } from "@bluelibs/runner";

const map = new LockableMap<string, number>("my-map");
map.set("a", 1);
map.lock();
map.set("b", 2); // throws lockableMapLockedError
```

### `durableWorkflowTag.defaults` — default input for `describe()`

```ts
const processOrder = r
  .task("app.tasks.processOrder")
  .tags([durableWorkflowTag.with({
    category: "orders",
    defaults: { orderId: "demo-001", amount: 99.99 },
  })])
  .run(async ({ orderId, amount }, deps) => { ... })
  .build();

// describe() uses defaults when no input is provided
const shape = await durable.describe(processOrder);
```

### Global Cron Scheduling (`globals.tags.cron` + `globals.resources.cron`)

Runner now ships with a built-in global cron scheduler.

- Tag tasks with `globals.tags.cron.with({...})` using a 5-field `expression`.
- `globals.resources.cron` discovers and schedules tagged tasks automatically at startup (registered by default).
- Supports `timezone`, `immediate`, `enabled`, `input`, `onError` (`"continue"` / `"stop"`), and `silent`.
- One cron tag per task (fork tasks if you need multiple schedules).

### `renewLock` on Durable Stores

`IDurableStore` gained an optional `renewLock?` method for lock-renewal during long-running executions:

```ts
renewLock?(resource: string, lockId: string, ttlMs: number): Promise<boolean>;
```

Returns `true` if the lock was renewed, `false` if it expired or was re-owned.

---

## Serializer Hardening

### `SymbolPolicy`

Control how Symbol payloads are handled during deserialization of **untrusted input**:

```ts
import { Serializer } from "@bluelibs/runner";

const serializer = new Serializer({
  symbolPolicy: "well-known-only", // recommended for untrusted payloads
});
```

| Value                   | Behaviour                                                                         |
| ----------------------- | --------------------------------------------------------------------------------- |
| `"allow-all"` (default) | All symbols pass through                                                          |
| `"well-known-only"`     | Only `Symbol.for(key)` and spec well-known symbols; unique `Symbol("...")` throws |
| `"disabled"`            | All Symbol payloads throw                                                         |

### Additional hardening options

```ts
new Serializer({
  allowedTypes: ["Date", "RegExp", "MyCustomType"], // allowlist; unknown types throw
  maxDepth: 50, // max recursion depth (default 1000)
  maxRegExpPatternLength: 256, // max pattern length (default 1024)
  allowUnsafeRegExp: false, // bypass ReDoS check (default false)
});
```

### ReDoS Detection Improvements

The RegExp validator now detects **overlapping-alternation** patterns (e.g. `(aa|aab)`) in addition to the existing nested-quantifier check — a common catastrophic-backtracking vector.

### Marker-key Escaping

Object keys named `__type` or `__graph` — Runner's internal protocol markers — are now automatically escaped on serialize and unescaped on deserialize (`$runner.escape::__type`). This prevents user data keys from being misread as protocol frames.

### Typed Serializer Errors

All `throw new Error(...)` calls inside the serializer were replaced with typed Runner errors (e.g. `invalidPayloadError`, `depthExceededError`, `symbolPolicyError`, `typeRegistryError`). These are caught and inspectable via `r.error.is()` or specific helpers.

---

## Tunnel / HTTP Exposure Improvements

### `x-runner-request-id` Header

Every tunnel request now gets a request-correlation id. If the client sends `x-runner-request-id` with a valid value (alphanumeric plus `._:-`, max 128 chars), it is reused. Otherwise a `crypto.randomUUID()` is generated server-side. The resolved id is echoed back in the response header.

```ts
// Client
headers: { "x-runner-request-id": "trace-abc-123" }

// Server echoes back
res.headers["x-runner-request-id"] // "trace-abc-123"
```

Auth failure audit log entries are also stamped with the request id.

### `allowAsyncContext: false` on Server Tunnel Resources

Opt out of async context propagation per tunnel resource:

```ts
nodeExposure.with({
  http: { ... },
  tunnels: [
    myTunnelResource.with({ allowAsyncContext: false })
  ],
})
```

When `false`, context serialization/deserialization is skipped for that tunnel's tasks and events. Multiple tunnel resources targeting the same task/event compute the final policy as a conjunction — a single `false` wins.

### Allowlist Selector Error Reporting

Errors thrown by function-based `tasks`/`events` selectors in tunnel allowlists are now surfaced via a structured reporter instead of being silently swallowed:

```ts
computeAllowList(tunnels, (info) => {
  // info: { selectorKind, candidateId, tunnelResourceId, error }
  console.warn("Allowlist selector error", info);
});
```

`createAllowListGuard` also accepts an optional `logger` to route these warnings through your structured logger.

### `tunnelPolicyTag` → `tunnelTaskPolicyTag`

The tag was renamed to `tunnelTaskPolicyTag` for clarity. The old name `tunnelPolicyTag` is kept as a deprecated re-export.

### Multipart Error Typing

Multipart limit violations now throw a typed Runner error (`nodeExposureMultipartLimitExceededError`) instead of a plain class, making them catchable via `r.error.is()`.

---

## Type-System Improvements

### `throws` on Middleware and Hooks (declarative contracts)

Middleware definitions and hooks can now advertise which errors they may surface:

```ts
const retryMiddleware = defineTaskMiddleware({
  id: "app.middleware.retry",
  throws: [MaxRetriesError],
  run: async ({ task, next }) => { ... },
});
```

This is purely **declarative** — no DI injection. Use `store.getAllThrows(task)` to aggregate the full contract across a task's dependency tree.

### `globals.middlewares` alias

`globals.middleware` and `globals.middlewares` are now both valid (identical). The plural form matches the naming convention used elsewhere.

### New Public Exports

```ts
import { cancellationError, RunnerError, LockableMap } from "@bluelibs/runner";
import { TaggedTask, TaggedResource } from "@bluelibs/runner";
import { ResourceInitMode } from "@bluelibs/runner";
import { EventEmissionFailureMode, IEventEmitReport } from "@bluelibs/runner";
import { SymbolPolicy } from "@bluelibs/runner";
```

---

## Reliability Fixes

- **Queue idle cleanup**: The `Queue` resource now cleans up idle internal queues to prevent unbounded memory growth over time.
- **Cache middleware**: Concurrent cache-miss requests for the same key now share a single pending promise instead of triggering N parallel computations.
- **Circuit Breaker half-open**: Improved state tracking and `resetTimeout` handling.
- **Shutdown hook errors**: Errors thrown inside shutdown hooks are now caught, logged, and attributed rather than causing an uncontrolled process crash.
- **Redis store**: Lock renewal uses a Lua script for atomicity. The `unsubscribe` event bus method now accepts a specific handler to avoid inadvertent mass-unsubscription.
- **RabbitMQ queue**: Increments `message.attempts` correctly on failure; adds structured error logging.
- **`dispose()` is idempotent**: A second call to `runtime.dispose()` is now a safe no-op.
- **Platform error propagation**: Uncaught exception handling is unified across Node, browser, and edge adapters.

---

## Documentation & Tooling

- `readmes/FULL_GUIDE.md` significantly expanded (+1 127 lines): new sections on Async Context, Serializer hardening, Observability, and Tunnel hardening.
- `readmes/TUNNELS.md` restructured: cleaner separation between server-side exposure and client-side consumption.
- `readmes/ADVANCED_DESIGN.md` and `readmes/GRACEFUL_SHUTDOWN.md` removed; content merged into the main guide.
- `guide-units/06-advanced.md` (+288 lines), `guide-units/11-reference.md` (+176 lines): new deep dives on error contracts, journal keys, and parallel init.
- `guide-units/08-testing.md` and `guide-units/09-troubleshooting.md` are new sections.
- `r.override(base)` fluent override builder and `r.override(base, fn)` shorthand are documented throughout.
- Dashboard (`src/node/durable/dashboard`) upgraded: react-router-dom, Vite bumped; API endpoints validated.
- `fastify-mikroorm` example migrated from `@mikro-orm/sqlite` to `@mikro-orm/better-sqlite`.
- TypeDoc, `@types/node`, and TypeScript versions bumped.

---

## Internal / Infrastructure

- Error definitions split from a single `src/errors.ts` into domain-specific files under `src/errors/`.
- Type-safety test suite split from one monolithic `typesafety.builder.test.ts` (470 lines, deleted) into isolated compile-time suites.
- `buildUniversalManifest` and `processShutdownHooks` moved from `src/tunnels/` to `src/tools/`.
- `activeRunResults` set in `run.ts` tracks live runtimes; three test-teardown helpers (`__disposeActiveRunResultsForTests`, `__snapshotActiveRunResultsForTests`, `__disposeActiveRunResultsForTestsExcept`) added for reliable test isolation.
- `createTestResource` deprecated in favour of plain `run()` for testing.

---

## Addendum

### `SymbolPolicy` uses lowercase string values

`symbolPolicy` values are now lowercase string literals:

- `"allow-all"` (default)
- `"well-known-only"`
- `"disabled"`

Example:

```ts
import { Serializer } from "@bluelibs/runner";

const serializer = new Serializer({
  symbolPolicy: "well-known-only",
});
```

`SymbolPolicy` remains exported, but its values now map to lowercase strings.
