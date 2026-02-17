# BlueLibs Runner: Fluent Builder Field Guide

> Token-friendly guide spotlighting the fluent builder API (`r.*`). Classic `defineX` / `resource({...})` remain supported for backwards compatibility.

For the landing overview, see [README.md](../README.md). For the complete guide, see [FULL_GUIDE.md](./FULL_GUIDE.md).

**Durable Workflows (Node-only):** For persistence and crash recovery, see `DURABLE_WORKFLOWS.md`. Includes `ctx.switch()` (replay-safe branching), `durable.describe()` (DI-accurate flow shape export), and `durableWorkflowTag.defaults` (default input for `describe(task)` when omitted) — see `DURABLE_WORKFLOWS_AI.md` for quick reference.

## Serializer Safety

When deserializing untrusted payloads, configure the serializer to restrict
symbol handling so payloads cannot grow the global Symbol registry.

```ts
import { Serializer, SymbolPolicy } from "@bluelibs/runner";

const serializer = new Serializer({
  symbolPolicy: SymbolPolicy.WellKnownOnly,
});
```

## Resources

```ts
import express from "express";
import { r, run, globals } from "@bluelibs/runner";
import { nodeExposure } from "@bluelibs/runner/node";

const server = r
  .resource<{ port: number }>("app.server")
  .context(() => ({ app: express() }))
  .init(async ({ port }, _deps, ctx) => {
    ctx.app.use(express.json());
    const listener = ctx.app.listen(port);
    return { ...ctx, listener };
  })
  .dispose(async ({ listener }) => listener.close())
  .build();

const createUser = r
  .task("app.tasks.createUser")
  .dependencies({ logger: globals.resources.logger })
  .inputSchema<{ name: string }>({ parse: (value) => value })
  .resultSchema<{ id: string; name: string }>({ parse: (value) => value })
  .run(async (input, { logger }) => {
    await logger.info(`Creating user ${input.name}`);
    return { id: "user-1", name: input.name };
  })
  .build();

const api = r
  .resource("app.api")
  .register([
    server.with({ port: 3000 }),
    nodeExposure.with({
      http: { basePath: "/__runner", listen: { port: 3000 } },
    }),
    createUser,
  ])
  .dependencies({ server, createUser })
  .init(async (_config, { server, createUser }) => {
    server.listener.on("listening", () => {
      console.log("Runner HTTP server ready on port 3000");
    });

    server.app.post("/users", async (req, res) => {
      const user = await createUser(req.body);
      res.json(user);
    });
  })
  .build();

const runtime = await run(api);
await runtime.runTask(createUser, { name: "Ada" });
// runtime.dispose() when you are done.
```

- `r.*.with(config)` produces a configured copy of the definition.
- `r.*.fork(newId, { register: "keep" | "drop" | "deep", reId })` creates a new resource with a different id but the same definition. Use `register: "drop"` to avoid re-registering nested items, or `register: "deep"` to deep-fork **registered resources** with new ids via `reId` (other registerables are not kept; resource dependencies pointing to deep-forked resources are remapped to those forks). Export forked resources to use as dependencies.
- `run(root)` wires dependencies, runs `init`, emits lifecycle events, and returns a runtime object with helpers such as `runTask`, `getResourceValue`, `getResourceConfig`, `getRootId`, `getRootConfig`, `getRootValue`, and `dispose`.
- Enable verbose logging with `run(root, { debug: "verbose" })`.

### Resource Forking

Use `.fork(newId, { register, reId })` to clone a resource definition under a new id (handy for multi-instance patterns).
Forks keep the same implementation/types but get separate runtime instances (no shared state). Use `register: "drop"` to clear registered items, or `register: "deep"` to deep-fork **registered resources** (resource tree) with new ids (non-resource registerables are not cloned/kept).
Prefer exporting forks so other tasks/resources can depend on them.
Forked resources expose provenance at `[definitions.symbolForkedFrom]` (`fromId`) for tooling/debugging.

## Tasks

Tasks are your business actions. They are plain async functions with DI, middleware, and validation.

```ts
import { r } from "@bluelibs/runner";

// Assuming: userService, loggingMiddleware, and tracingMiddleware are defined elsewhere
const sendEmail = r
  .task("app.tasks.sendEmail")
  .inputSchema<{ to: string; subject: string; body: string }>({
    parse: (value) => value,
  })
  .dependencies({ emailer: userService })
  .middleware([loggingMiddleware.with({ label: "email" }), tracingMiddleware])
  .run(async (input, { emailer }) => {
    await emailer.send(input);
    return { delivered: true };
  })
  .build();
```

**Builder composition rules (applies to tasks, resources, hooks, middleware):**

- `.dependencies()` accepts a literal map or function `(config) => deps`; appends (shallow-merge) by default
- `.middleware()` appends by default
- `.tags()` appends by default
- Pass `{ override: true }` to any of these methods to replace instead of append
- Provide result validation with `.resultSchema()` when the function returns structured data

## Events and Hooks

Events are strongly typed signals. Hooks listen to them with predictable execution order.

```ts
import { r } from "@bluelibs/runner";

const userRegistered = r
  .event("app.events.userRegistered")
  .payloadSchema<{ userId: string; email: string }>({ parse: (v) => v })
  .build();

// Type-only alternative (no runtime payload validation):
// const userRegistered = r.event<{ userId: string; email: string }>("app.events.userRegistered").build();

// Assuming: userService and sendEmail are defined elsewhere
const registerUser = r
  .task("app.tasks.registerUser")
  .dependencies({ userRegistered, userService })
  .run(async (input, deps) => {
    const user = await deps.userService.create(input);
    await deps.userRegistered({ userId: user.id, email: user.email });
    return user;
  })
  .build();

const sendWelcomeEmail = r
  .hook("app.hooks.sendWelcomeEmail")
  .on(userRegistered)
  .dependencies({ mailer: sendEmail })
  .run(async (event, { mailer }) => {
    await mailer({
      to: event.data.email,
      subject: "Welcome",
      body: "Welcome!",
    });
  })
  .build();
```

- Use `.on(onAnyOf(...))` to listen to several events while keeping inference.
- Hooks can set `.order(priority)`; lower numbers run first. Call `event.stopPropagation()` inside `run` to cancel downstream hooks.
- Wildcard hooks use `.on("*")` and receive every emission except events tagged with `globals.tags.excludeFromGlobalHooks`.
- Use `.parallel(true)` on event definitions to enable batched parallel execution:
  - Listeners with the same `order` run concurrently within a batch
  - Batches execute sequentially in ascending order priority
  - All listeners in a failing batch run to completion; if multiple fail, an `AggregateError` with all errors is thrown
  - Propagation is checked between batches only (not mid-batch since parallel listeners can't be stopped mid-flight)
  - If any listener throws, subsequent batches will not run
- Event emitters (dependency-injected or `runtime.emitEvent`) support options:
  - `failureMode: "fail-fast" | "aggregate"`
  - `throwOnError` (default `true`)
  - `report` (when `true`, returns `IEventEmitReport`)
- `report: true` is useful when you want to aggregate hook failures without throwing immediately:

```ts
import { r } from "@bluelibs/runner";

const notify = r.event("app.events.notify").build();

const task = r
  .task("app.tasks.notify")
  .dependencies({ notify })
  .run(async (_input, { notify }) => {
    const report = await notify(undefined, {
      report: true,
      throwOnError: false,
      failureMode: "aggregate",
    });
    return report.failedListeners;
  })
  .build();
```

## Middleware

Middleware wraps tasks or resources. Fluent builders live under `r.middleware`.

```ts
import { r } from "@bluelibs/runner";
import { globals } from "@bluelibs/runner";

const auditTasks = r.middleware
  .task("app.middleware.audit")
  .dependencies({ logger: globals.resources.logger })
  .everywhere((task) => !task.id.startsWith("admin."))
  .run(async ({ task, next }, { logger }) => {
    logger.info(`→ ${task.definition.id}`);
    const result = await next(task.input);
    logger.info(`← ${task.definition.id}`);
    return result;
  })
  .build();

const cacheResources = r.middleware
  .resource("app.middleware.cache")
  .configSchema<{ ttl: number }>({ parse: (value) => value })
  .run(async ({ value, next }, _deps, config) => {
    if (value.current) {
      return value.current;
    }
    const computed = await next();
    value.current = computed;
    setTimeout(() => (value.current = null), config.ttl);
    return computed;
  })
  .build();
```

Attach middleware using `.middleware([auditTasks])` on the definition that owns it, and register the middleware alongside the target resource or task at the root.

- Contract middleware: middleware can declare `Config`, `Input`, `Output` generics; tasks using it must conform (contracts intersect across `.middleware([...])` and `.tags([...])`). Collisions surface as `InputContractViolationError` / `OutputContractViolationError` in TypeScript; if you add `.inputSchema()`, ensure the schema's inferred type includes the contract shape.

```ts
type AuthConfig = { requiredRole: string };
type AuthInput = { user: { role: string } };
type AuthOutput = { ok: true };

const auth = r.middleware
  .task<AuthConfig, AuthInput, AuthOutput>("app.middleware.auth")
  .run(async ({ task, next }) => next(task.input))
  .build();
```

### ExecutionJournal

**ExecutionJournal** is a typed key-value store scoped to a single task execution, enabling middleware and tasks to share state. It has **fail-fast semantics**: calling `set()` on an existing key throws an error (prevents silent bugs from middleware clobbering each other). Use `{ override: true }` to intentionally update.

```ts
import { r, globals, journal } from "@bluelibs/runner";

const abortControllerKey =
  globals.middleware.task.timeout.journalKeys.abortController;

// Middleware accesses journal via execution input
const auditMiddleware = r.middleware
  .task("app.middleware.audit")
  .run(async ({ task, next, journal }) => {
    // Access typed values from journal
    const ctrl = journal.get(abortControllerKey);
    if (journal.has(abortControllerKey)) {
      /* ... */
    }
    return next(task.input);
  })
  .build();

// Task accesses journal via context
const myTask = r
  .task("app.tasks.myTask")
  .run(async (input, deps, { journal }) => {
    journal.set(abortControllerKey, new AbortController());
    // To update existing: journal.set(key, newValue, { override: true });
    return "done";
  })
  .build();

// Create custom keys
const myKey = journal.createKey<{ startedAt: Date }>("app.middleware.timing");
```

**Built-in Middleware Journal Keys**: Global middlewares (`retry`, `cache`, `circuitBreaker`, `rateLimit`, `fallback`, `timeout`) expose runtime state via typed journal keys at `globals.middleware.task.<name>.journalKeys`. For example, `retry` exposes `attempt` and `lastError`; `cache` exposes `hit`; `circuitBreaker` exposes `state` and `failures`. Access these via `journal.get(key)` without deep imports.

## Tags

Tags let you annotate definitions with metadata that can be queried later.

```ts
import { r, globals } from "@bluelibs/runner";

const httpRouteTag = r
  .tag("app.tags.httpRoute")
  .configSchema<{ method: "GET" | "POST"; path: string }>({
    parse: (value) => value,
  })
  .build();

const getHealth = r
  .task("app.tasks.getHealth")
  .tags([httpRouteTag.with({ method: "GET", path: "/health" })])
  .run(async () => ({ status: "ok" }))
  .build();
```

Retrieve tagged items by using `globals.resources.store` inside a hook or resource and calling `store.getTasksWithTag(tag)`.

**Node durable workflows must be tagged** with `durableWorkflowTag` from `@bluelibs/runner/node` to be discoverable via `durable.getWorkflows()` at runtime. This tag is required, not optional. Workflow execution is explicit via the durable API (`durable.start(...)` / `durable.startAndWait(...)`). The tag is discovery metadata only; `startAndWait(...)` provides the unified result envelope `{ durable: { executionId }, data }`.

- Contract tags (a "smart tag"): define type contracts for task input/output (or resource config/value) via `r.tag<TConfig, TInputContract, TOutputContract>(id)`. They don't change runtime behavior; they shape the inferred types and compose with contract middleware.
- Smart tags: built-in tags like `globals.tags.system`, `globals.tags.debug`, and `globals.tags.excludeFromGlobalHooks` change framework behavior; use them for per-component debug or to opt out of global hooks.

```ts
type Input = { id: string };
type Output = { name: string };
const userContract = r.tag<void, Input, Output>("contract.user").build();

const getUser = r
  .task("app.tasks.getUser")
  .tags([userContract])
  .run(async (input) => ({ name: input.id }))
  .build();
```

## Async Context

Async Context provides per-request/thread-local state via the platform's `AsyncLocalStorage` (Node, and Deno when `AsyncLocalStorage` is available). Use the fluent builder under `r.asyncContext` or the classic `asyncContext({ ... })` export.

> **Platform Note**: Async Context requires `AsyncLocalStorage`. It is available in Node.js and Deno (when exposed), and unavailable in browser runtimes.

```ts
import { r } from "@bluelibs/runner";

const requestContext = r
  .asyncContext<{ requestId: string }>("app.ctx.request")
  // below is optional
  .configSchema(z.object({ ... }))
  // for tunnels mostly
  .serialize((data) => JSON.stringify(data))
  .parse((raw) => JSON.parse(raw))
  .build();

// Provide and read within an async boundary
await requestContext.provide({ requestId: "abc" }, async () => {
  const ctx = requestContext.use(); // { requestId: "abc" }
});

// Require middleware for tasks that need the context
r.task("task").middleware([requestContext.require()]);
```

- Recommended ids: `{domain}.ctx.{noun}` (for example: `app.ctx.request`).
- `.configSchema(schema)` (optional) validates the value passed to `provide(...)`.
- If you don't provide `serialize`/`parse`, Runner uses its default serializer to preserve Dates, RegExp, etc.
- You can also inject async contexts as dependencies; the injected value is the helper itself. Contexts must be registered to be used.
- Optional dependencies: `dependencies({ requestContext: requestContext.optional() })` injects `undefined` if the context isn't registered.

```ts
const whoAmI = r
  .task("app.tasks.whoAmI")
  .dependencies({ requestContext })
  .run(async (_input, { requestContext }) => requestContext.use().requestId)
  .build();

const app = r.resource("app").register([requestContext, whoAmI]).build();
```

## Queue

`Queue` is a cooperative FIFO task queue. Tasks run one-after-another, with dead-lock detection and graceful disposal.

The global resource `globals.resources.queue` provides a named queue factory — each `id` gets its own isolated `Queue` instance.

**Key methods:**

- `queue.run(id, task)` — schedule `task` (receives an `AbortSignal`) on the queue identified by `id`; creates the queue lazily.

**Event lifecycle:** `enqueue` → `start` → `finish` | `error`. On disposal: `disposed`. On cancel: `cancel`.

```ts
import { r, run, globals } from "@bluelibs/runner";

const processOrder = r
  .task("app.tasks.processOrder")
  .dependencies({ queue: globals.resources.queue })
  .run(async (input: { orderId: string }, { queue }) => {
    // Tasks with the same orderId run sequentially
    return queue.run(input.orderId, async (signal) => {
      if (signal.aborted) return;
      // ... process order
      return { processed: true };
    });
  })
  .build();
```

For advanced usage, import `Queue` directly and use `on(type, handler)` / `once(type, handler)` to observe lifecycle events. Call `dispose({ cancel: true })` to abort in-flight work via the `AbortSignal`.

## Errors

Define typed, namespaced errors with a fluent builder. Built helpers expose `throw` and `is`:

```ts
import { r } from "@bluelibs/runner";

// Fluent builder
const AppError = r
  .error<{ code: number; message: string }>("app.errors.AppError")
  .httpCode(400)
  .dataSchema({ parse: (value) => value })
  .format((d) => `[${d.code}] ${d.message}`)
  .remediation("Check the request payload and retry with valid data.")
  .build();

try {
  AppError.throw({ code: 400, message: "Oops" });
} catch (err) {
  if (AppError.is(err, { code: 400 })) {
    // err.message -> "[400] Oops\n\nRemediation: Check the request payload and retry with valid data."
    // err.httpCode -> 400
    // err.remediation -> "Check the request payload and retry with valid data."
    // AppError.httpCode -> 400
  }
}
```

- Recommended ids: `{domain}.errors.{PascalCaseName}` (for example: `app.errors.InvalidCredentials`).
- The thrown `Error` has `name = id` and `message = format(data)`. If you don't provide `.format(...)`, the default is `JSON.stringify(data)`.
- `.httpCode(number)` sets an HTTP status for the error helper (must be an integer in `100..599`). The helper exposes `helper.httpCode`, and thrown typed errors expose `error.httpCode`.
- `.remediation(stringOrFn)` attaches fix-it advice. Accepts a static string or `(data) => string`. When present, `error.message` and `error.toString()` include `\n\nRemediation: <advice>`. The raw advice is also available via `error.remediation`.
- `message` is not required in the data unless your custom formatter expects it.
- `helper.is(err, partialData?)` accepts an optional partial data filter and performs shallow strict matching (`===`) on each provided key.
- Declare a task/resource error contract with `.throws([AppError])` (or ids). This is declarative only and does not imply DI.
- `.throws()` is also available on hooks, task middleware, and resource middleware builders — same semantics.
- `.throws([...])` accepts error helpers or string ids, normalizes to ids, and deduplicates repeated declarations.
- `store.getAllThrows(task | resource)` aggregates all declared error ids from a task or resource and its full dependency chain: own throws, local + everywhere middleware throws, resource dependency throws (with their middleware), and — for tasks — hook throws for events the task can emit. Returns a deduplicated `readonly string[]`.
- Use `r.error.is(err)` to check if an error is _any_ Runner error (not just a specific one). This type guard narrows to `RunnerError` with `id`, `data`, `httpCode`, and `remediation` properties. Useful in catch blocks or error filters:
  ```ts
  if (r.error.is(err, { code: 400 })) {
    console.error(`Runner error: ${err.id} (${err.httpCode || "N/A"})`);
  }
  ```
- For HTTP/tunnel clients, you can pass an `errorRegistry` to rethrow remote errors as your typed helpers (optional):

  ```ts
  import { createHttpClient, Serializer } from "@bluelibs/runner";

  const client = createHttpClient({
    baseUrl: "http://localhost:3000/__runner",
    serializer: new Serializer(),
    errorRegistry: new Map([[AppError.id, AppError]]),
  });
  ```

  Notes:
  - `errorRegistry` is optional. If omitted, typed errors remain `TunnelError` instances.
  - `serializer` is required for `createHttpClient`, but it is fully customizable (any `SerializerLike` works). If you use `globals.resources.httpClientFactory`, the serializer, error registry, and async contexts are auto-injected, so you can omit them from your own config.
  - Other supported options on the same config object: `auth`, `timeoutMs`, `fetchImpl`, `onRequest`, and `contexts`.

## Overrides

Override a task/resource/hook/middleware while preserving `id`. Use the helper or the fluent override builder:

```ts
const mockMailer = r
  .override(realMailer)
  .init(async () => new MockMailer())
  .build();

const app = r
  .resource("app")
  .register([realMailer])
  .overrides([mockMailer])
  .build();
```

- `r.override(base)` starts from the base definition and applies fluent mutations using the same composition rules as the base builder.
- Hook overrides keep the same `.on` target; only behavior/metadata is overridable.
- The `override(base, patch)` helper remains for direct, shallow patches.

## Runtime & Lifecycle

- `run(root, options)` wires dependencies, initializes resources, and returns the runtime object: `runTask`, `emitEvent`, `getResourceValue`, `getLazyResourceValue`, `getResourceConfig`, `getRootId`, `getRootConfig`, `getRootValue`, `store`, `logger`, and `dispose`. `getLazyResourceValue` is available only when `run(..., { lazy: true })` is enabled.
- `emitEvent(event, payload, options?)` accepts the same emission options (`failureMode`, `throwOnError`, `report`) as dependency emitters.
- Run options highlights: `debug` (normal/verbose or custom config), `logs` (printThreshold/strategy/buffer), `errorBoundary` and `onUnhandledError`, `shutdownHooks`, `dryRun`, `lazy`, and `initMode` (`"sequential"` or `"parallel"`; string literal values work without importing enums).
- Task interceptors: inside resource init, call `deps.someTask.intercept(async (next, input) => next(input))` to wrap a single task execution at runtime (runs inside middleware; won't run if middleware short-circuits).
- Shutdown hooks: install signal listeners to call `dispose` (default in `run`).
- Unhandled errors: `onUnhandledError` receives a structured context (kind and source) for telemetry or controlled shutdown.

## Reliability & Performance

- **Concurrency**: Limit parallel execution using a shared or local `Semaphore`.
  ```ts
  .middleware([globals.middleware.task.concurrency.with({ limit: 5 })])
  ```
- **Circuit Breaker**: Trip after failures to prevent cascading downstream pressure.
  ```ts
  .middleware([globals.middleware.task.circuitBreaker.with({ failureThreshold: 5, resetTimeout: 30000 })])
  ```
- **Rate Limit**: Protect APIs with fixed-window request counting.
  ```ts
  .middleware([globals.middleware.task.rateLimit.with({ windowMs: 60000, max: 100 })])
  ```
- **Temporal (Debounce/Throttle)**: Control execution frequency.
  ```ts
  .middleware([globals.middleware.task.debounce.with({ ms: 300 })])
  ```
- **Fallback**: Provide a Plan B (value, function, or another task) when the primary fails.
  ```ts
  // Recommended: Fallback should be outer (on top) of Retry to catch final failures
  .middleware([
    globals.middleware.task.fallback.with({ fallback: "Guest User" }),
    globals.middleware.task.retry.with({ attempts: 3 })
  ])
  ```
- **Retry/Backoff**: `globals.middleware.task.retry` and `globals.middleware.resource.retry` for transient failures.
  ```ts
  .middleware([globals.middleware.task.retry.with({ retries: 3 })])
  ```
- **Caching**: `globals.middleware.task.cache` plus `globals.resources.cache`.
  ```ts
  .middleware([globals.middleware.task.cache.with({ ttl: 60000 })])
  ```
- **Timeouts**: `globals.middleware.task.timeout` / `globals.middleware.resource.timeout` using `AbortController`.
  ```ts
  .middleware([globals.middleware.task.timeout.with({ ttl: 5000 })])
  ```
- **Logging & Debug**: `globals.resources.logger` and `globals.resources.debug`.
  ```ts
  // Verbose debug logging for a specific task
  .tags([globals.tags.debug])
  ```

## HTTP & Tunnels

Tunnels let you call Runner tasks/events across a process boundary over a small HTTP surface (Node-only exposure via `nodeExposure`), while preserving task ids, middleware, validation, typed errors, and async context.

For "no call-site changes", register a client-mode tunnel resource tagged with `globals.tags.tunnel` plus phantom tasks for the remote ids; the tunnel middleware auto-routes selected tasks/events to an HTTP client. For explicit boundaries, create a client once and call `client.task(id, input)` / `client.event(id, payload)` directly. Full guide: `readmes/TUNNELS.md`.

Node client note: prefer `createHttpMixedClient` (it uses the serialized-JSON path via Runner `Serializer` + `fetch` when possible and switches to the streaming-capable Smart path when needed). If a task may return a stream even for plain JSON inputs (ex: downloads), set `forceSmart` on Mixed (or use `createHttpSmartClient` directly).

Node exposure hardening: use `x-runner-request-id` for request correlation and enforce rate limiting at the edge/proxy layer.

## Serialization

Runner ships with a serializer that round-trips Dates, RegExp, binary, and custom shapes across Node and web.

It also supports:

- `bigint` (encoded as a decimal string under `__type: "BigInt"`)
- `symbol` for `Symbol.for(key)` and well-known symbols like `Symbol.iterator` (unique `Symbol("...")` values are rejected because identity cannot be preserved)

```ts
import { r, globals } from "@bluelibs/runner";

const serializerSetup = r
  .resource("app.serialization")
  .dependencies({ serializer: globals.resources.serializer })
  .init(async (_config, { serializer }) => {
    class Distance {
      constructor(
        public value: number,
        public unit: string,
      ) {}
    }

    serializer.addType({
      id: "Distance",
      is: (obj): obj is Distance => obj instanceof Distance,
      serialize: (d) => ({ value: d.value, unit: d.unit }),
      deserialize: (json) => new Distance(json.value, json.unit),
      strategy: "value",
    });
  })
  .build();
```

Use `new Serializer()` when you need a standalone instance outside DI.

Note on files: The "File" you see in tunnels is not a custom serializer type. Runner uses a dedicated `$runnerFile: "File"` sentinel in inputs which the tunnel client/server convert to multipart streams via a manifest. File handling is performed by the tunnel layer (manifest hydration and multipart), not by the serializer. Keep using `createWebFile`/`createNodeFile` for uploads.

## Testing

- In unit tests, prefer running a minimal root resource and call `await run(root)` to get `runTask`, `emitEvent`, `getResourceValue`, or `getResourceConfig`.
- The Jest runner has a watchdog (`JEST_WATCHDOG_MS`, default 10 minutes) to avoid "hung test run" situations.
- For durable workflow tests, use `createDurableTestSetup` from `@bluelibs/runner/node` for fast, in-memory execution.

```ts
import { run } from "@bluelibs/runner";

test("sends welcome email", async () => {
  const app = r
    .resource("spec.app")
    .register([sendWelcomeEmail, registerUser])
    .build();
  const runtime = await run(app);
  await runtime.runTask(registerUser, { email: "user@example.com" });
  await runtime.dispose();
});
```

## Observability & Debugging

- Pass `{ debug: "verbose" }` to `run` for structured logs about registration, middleware, and lifecycle events.
- `globals.resources.logger` exposes the framework logger; register your own logger resource and override it at the root to capture logs centrally.
- Hooks and tasks emit metadata through `globals.resources.store`. Query it for dashboards or editor plugins.
- Use middleware for tracing (`r.middleware.task("...").run(...)`) to wrap every task call.
- `Semaphore` and `Queue` publish local lifecycle events through isolated `EventManager` instances (`on/once`). These are separate from the global EventManager used for business-level application events. Event names: semaphore → `queued/acquired/released/timeout/aborted/disposed`; queue → `enqueue/start/finish/error/cancel/disposed`.

## Metadata & Namespacing

- Meta: `.meta({ title, description })` on tasks/resources/events/middleware for human-friendly docs and tooling; extend meta types via module augmentation when needed.
- Namespacing: keep ids consistent with `domain.resources.name`, `domain.tasks.name`, `domain.events.name`, `domain.hooks.on-name`, `domain.middleware.{task|resource}.name`, `domain.errors.ErrorName`, and `domain.ctx.name`.
- Runtime validation: `inputSchema`, `resultSchema`, `payloadSchema`, `configSchema` share the same `parse(input)` contract; config validation happens on `.with()`, task/event validation happens on call/emit.

## Advanced Patterns

- **Optional dependencies:** mark dependencies as optional (`analytics: analyticsService.optional()`) so the builder injects `undefined` when the resource is absent.
- **Conditional registration:** `.register((config) => (config.enableFeature ? [featureResource] : []))`.
- **Async coordination:** `Semaphore` (O(1) linked queue for heavy contention) and `Queue` live in the main package. Both use isolated EventManagers internally for their lifecycle events, separate from the global EventManager used for business-level application events.
- **Event safety:** Runner detects event emission cycles and throws an `EventCycleError` with the offending chain.
- **Internal services:** `globals.resources.runtime` resolves to the same runtime object returned by `run(...)`. It supports `runTask`, `emitEvent`, `getResourceValue`, `getLazyResourceValue`, `getResourceConfig`, `getRootId`, `getRootConfig`, `getRootValue`, and `dispose`. Bootstrap note: when injected inside a resource `init()`, only that resource's dependencies are guaranteed initialized; unrelated resources may still be pending.

## Interop With Classic APIs

Existing code that uses `resource({ ... })`, `task({ ... })`, or `defineX` keeps working. You can gradually migrate:

```ts
import { r, resource as classicResource } from "@bluelibs/runner";

const classic = classicResource({ id: "legacy", init: async () => "ok" });
const modern = r.resource("modern").register([classic]).build();
```
