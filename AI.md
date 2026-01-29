# BlueLibs Runner: Fluent Builder Field Guide

> Token-friendly guide spotlighting the fluent builder API (`r.*`). Classic `defineX` / `resource({...})` remain supported for backwards compatibility.

For the landing overview, see [README.md](./README.md). For the complete guide, see [GUIDE.md](./GUIDE.md).

## Durable Workflows (Node-only)

Durable workflows are available from `@bluelibs/runner/node` (implemented under `src/node/durable/`).
See `readmes/DURABLE_WORKFLOWS.md` (full) or `readmes/DURABLE_WORKFLOWS_AI.md` (token-friendly).
They provide replay-safe primitives like `ctx.step(...)`, `ctx.sleep(...)`, `ctx.emit(...)`, and `ctx.waitForSignal(...)`.
Use them when you need persistence and recovery across restarts/crashes.

Note: the durable "real backends" integration suite (Redis + RabbitMQ) is env-gated and will
skip unless `DURABLE_INTEGRATION=1` is set (see `readmes/DURABLE_WORKFLOWS.md`).

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
- `r.*.fork(newId)` creates a new resource with a different id but the same definition—useful for multi-instance patterns. Export forked resources to use as dependencies.
- `run(root)` wires dependencies, runs `init`, emits lifecycle events, and returns helpers such as `runTask`, `getResourceValue`, and `dispose`.
- Enable verbose logging with `run(root, { debug: "verbose" })`.

### Resource Forking

Use `.fork(newId)` to clone a resource definition under a new id (handy for multi-instance patterns).
Forks keep the same implementation/types but get separate runtime instances (no shared state).
Prefer exporting forks so other tasks/resources can depend on them.

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
- `.tags()` replaces the list each time
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

- Contract middleware: middleware can declare `Config`, `Input`, `Output` generics; tasks using it must conform (contracts intersect across `.middleware([...])` and `.tags([...])`). Collisions surface as `InputContractViolationError` / `OutputContractViolationError` in TypeScript; if you add `.inputSchema()`, ensure the schema’s inferred type includes the contract shape.

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

**Built-in Middleware Journal Keys**: Several global middlewares expose their runtime state via journal keys:

| Middleware | Key | Type | Description |
|---|---|---|---|
| `retry` | `globals.middleware.task.retry.journalKeys.attempt` | `number` | Current retry attempt (0-indexed) |
| `retry` | `globals.middleware.task.retry.journalKeys.lastError` | `Error \| undefined` | Error from previous attempt |
| `cache` | `globals.middleware.task.cache.journalKeys.hit` | `boolean` | Whether the cache middleware returned a cached result |
| `circuitBreaker` | `globals.middleware.task.circuitBreaker.journalKeys.state` | `"CLOSED" \| "OPEN" \| "HALF_OPEN"` | Current circuit state |
| `circuitBreaker` | `globals.middleware.task.circuitBreaker.journalKeys.failures` | `number` | Current failure count |
| `rateLimit` | `globals.middleware.task.rateLimit.journalKeys.remaining` | `number` | Remaining requests in window |
| `rateLimit` | `globals.middleware.task.rateLimit.journalKeys.resetTime` | `number` | Timestamp when window resets |
| `rateLimit` | `globals.middleware.task.rateLimit.journalKeys.limit` | `number` | Configured limit |
| `fallback` | `globals.middleware.task.fallback.journalKeys.active` | `boolean` | Whether fallback was activated |
| `fallback` | `globals.middleware.task.fallback.journalKeys.error` | `Error \| undefined` | Error that triggered fallback |
| `timeout` | `globals.middleware.task.timeout.journalKeys.abortController` | `AbortController` | Controller for aborting the task |

Note: these keys are available via `globals` (no deep imports required).

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

- Contract tags (a “smart tag”): define type contracts for task input/output (or resource config/value) via `r.tag<TConfig, TInputContract, TOutputContract>(id)`. They don’t change runtime behavior; they shape the inferred types and compose with contract middleware.
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

Async Context provides per-request/thread-local state via the platform's `AsyncLocalStorage` (Node). Use the fluent builder under `r.asyncContext` or the classic `asyncContext({ ... })` export.

> **Platform Note**: `AsyncLocalStorage` is Node.js-only. Async Context is unavailable in browsers/edge runtimes.

```ts
import { r } from "@bluelibs/runner";

const requestContext = r
  .asyncContext<{ requestId: string }>("app.ctx.request")
  // below is optional
  .configSchema(z.object({ ... }))
  .serialize((data) => JSON.stringify(data))
  .parse((raw) => JSON.parse(raw))
  .build();

// Provide and read within an async boundary
await requestContext.provide({ requestId: "abc" }, async () => {
  const ctx = requestContext.use(); // { requestId: "abc" }
});

// Require middleware for tasks that need the context
r.task('task').middleware([requestContext.require()]);
```

- If you don't provide `serialize`/`parse`, Runner uses its default serializer to preserve Dates, RegExp, etc.
- You can also inject async contexts as dependencies; the injected value is the helper itself. Contexts must be registered to be used.

```ts
const whoAmI = r
  .task("app.tasks.whoAmI")
  .dependencies({ requestContext })
  .run(async (_input, { requestContext }) => requestContext.use().requestId)
  .build();

const app = r.resource("app").register([requestContext, whoAmI]).build();
```

## Errors

Define typed, namespaced errors with a fluent builder. Built helpers expose `throw`, `is`, and `toString`:

```ts
import { r } from "@bluelibs/runner";

// Fluent builder
const AppError = r
  .error<{ code: number; message: string }>("app.errors.AppError")
  .dataSchema(zod) // or { parse(obj) => obj }
  .build();

try {
  AppError.throw({ code: 400, message: "Oops" });
} catch (err) {
  if (AppError.is(err)) {
    // Do something
  }
}
```

- Error data must include a `message: string`. The thrown `Error` has `name = id` and `message = data.message` for predictable matching and logging.
- Declare a task/resource error contract with `.throws([AppError])` (or ids). This is declarative only and does not imply DI.

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

- `run(root, options)` wires dependencies, initializes resources, and returns helpers: `runTask`, `emitEvent`, `getResourceValue`, `store`, `logger`, and `dispose`.
- Run options highlights: `debug` (normal/verbose or custom config), `logs` (printThreshold/strategy/buffer), `errorBoundary` and `onUnhandledError`, `shutdownHooks`, `dryRun`.
- Task interceptors: inside resource init, call `deps.someTask.intercept(async (next, input) => next(input))` to wrap a single task execution at runtime (runs inside middleware; won’t run if middleware short-circuits).
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

Run Node exposures and connect to remote Runners with fluent resources.

`nodeExposure` is a Runner **resource** that starts an HTTP server and exposes a controlled surface for executing tasks and emitting events over HTTP (under a `basePath` like `/__runner`).

```ts
	import { r, globals } from "@bluelibs/runner";
	import { nodeExposure } from "@bluelibs/runner/node";

const httpExposure = nodeExposure.with({
  http: {
    basePath: "/__runner",
    listen: { host: "0.0.0.0", port: 7070 },
    auth: { token: process.env.RUNNER_TOKEN },
    // Configurable security limits (optional)
    limits: {
      json: { maxSize: 1024 * 1024 * 5 }, // 5MB
      multipart: { fileSize: 1024 * 1024 * 50 }, // 50MB
    }
  },
});

> [!NOTE]
> **Security & DoS Protection**: The HTTP tunnel provides built-in protections including timing-safe authentication, request body size limits (default 2MB for JSON, 20MB for multipart files), and internal error masking (500 errors are sanitized to prevent information leakage).
>
> **Fail-closed exposure**: `nodeExposure` requires a server-mode HTTP tunnel resource to enable task/event execution. For legacy/dev usage, set `http.dangerouslyAllowOpenExposure: true`.

const tunnelClient = r
  .resource("app.tunnels.http")
  .tags([globals.tags.tunnel])
  .dependencies({ serializer: globals.resources.serializer })
  .init(async (_config, { serializer }) => ({
    mode: "client" as const,
    transport: "http" as const,
    tasks: (task) => task.id.startsWith("remote.tasks."),
    client: globals.tunnels.http.createClient({
      url: process.env.REMOTE_URL ?? "http://127.0.0.1:7070/__runner",
      auth: { token: process.env.RUNNER_TOKEN },
      serializer,
    }),
  }))
  .build();

const root = r
  .resource("app")
  .register([httpExposure, tunnelClient, getHealth])
  .build();
```

### HTTP Client Factory (Recommended)

The `globals.resources.httpClientFactory` automatically injects serializer, error registry, and async contexts from the store:

```ts
import { r, globals } from "@bluelibs/runner";

const myTask = r
  .task("app.tasks.callRemote")
  .dependencies({ clientFactory: globals.resources.httpClientFactory })
  .run(async (input, { clientFactory }) => {
    // Client automatically has serializer, errors, and contexts injected
    const client = clientFactory({
      baseUrl: process.env.API_URL,
      auth: { token: process.env.API_TOKEN },
    });

    return await client.task("remote.task", input);
  })
  .build();

// Events: default is ack-only
// await client.event("remote.event", { message: "hi" });
//
// If you need the final (potentially mutated) payload back (requires server support):
// const finalPayload = await client.eventWithResult?.("remote.event", { message: "hi" });

// Node streaming clients via Node DI factories
import { globals as nodeGlobals } from "@bluelibs/runner/node";

const nodeTask = r
  .task("app.tasks.streamingCall")
  .dependencies({ smartFactory: nodeGlobals.resources.httpSmartClientFactory })
  .run(async (input, { smartFactory }) => {
    const client = smartFactory({
      baseUrl: process.env.API_URL,
    });
    // Supports duplex streams and multipart uploads
    return await client.task("remote.streaming.task", input);
  })
  .build();
```

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
      typeName() {
        return "Distance";
      }
      toJSONValue() {
        return { value: this.value, unit: this.unit };
      }
    }

    serializer.addType(
      "Distance",
      (json) => new Distance(json.value, json.unit),
    );
  })
  .build();
```

Use `getDefaultSerializer()` when you need a standalone instance outside DI.

Note on files: The “File” you see in tunnels is not a custom serializer type. Runner uses a dedicated `$runnerFile: "File"` sentinel in inputs which the tunnel client/server convert to multipart streams via a manifest. File handling is performed by the tunnel layer (manifest hydration and multipart), not by the serializer. Keep using `createWebFile`/`createNodeFile` for uploads.

## Testing

- Durable test helpers: `createDurableTestSetup` and `waitUntil` from `@bluelibs/runner/node` for fast, in-memory durable workflows in tests.
- The Jest runner has a watchdog (`JEST_WATCHDOG_MS`, default 10 minutes) to avoid “hung test run” situations.
- In unit tests, prefer running a minimal root resource and call `await run(root)` to get `runTask`, `emitEvent`, or `getResourceValue`.
- `createTestResource` is available for legacy suites but new code should compose fluent resources directly.

Example:

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

Durable test setup example:

```ts
import { r, run } from "@bluelibs/runner";
import { createDurableTestSetup } from "@bluelibs/runner/node";

const { durable } = createDurableTestSetup();

const task = r
  .task("spec.durable.hello")
  .dependencies({ durable })
  .run(async (_input: undefined, { durable }) => {
    const ctx = durable.use();
    await ctx.step("hello", async () => "ok");
    return { ok: true };
  })
  .build();

const app = r.resource("spec.app").register([durable, task]).build();
const runtime = await run(app);
const durableRuntime = runtime.getResourceValue(durable);
await durableRuntime.execute(task);
await runtime.dispose();
```

## Observability & Debugging

- Pass `{ debug: "verbose" }` to `run` for structured logs about registration, middleware, and lifecycle events.
- `globals.resources.logger` exposes the framework logger; register your own logger resource and override it at the root to capture logs centrally.
- Hooks and tasks emit metadata through `globals.resources.store`. Query it for dashboards or editor plugins.
- Use middleware for tracing (`r.middleware.task("...").run(...)`) to wrap every task call.
- `Semaphore` and `Queue` publish local lifecycle events through isolated `EventManager` instances (`on/once`). These are separate from the global EventManager used for business-level application events. Event names: semaphore → `queued/acquired/released/timeout/aborted/disposed`; queue → `enqueue/start/finish/error/cancel/disposed`.

## Metadata & Namespacing

- Meta: `.meta({ title, description })` on tasks/resources/events/middleware for human-friendly docs and tooling; extend meta types via module augmentation when needed.
- Namespacing: keep ids consistent with `domain.resources.name`, `domain.tasks.name`, `domain.events.name`, `domain.hooks.on-name`, and `domain.middleware.{task|resource}.name`.
- Runtime validation: `inputSchema`, `resultSchema`, `payloadSchema`, `configSchema` share the same `parse(input)` contract; config validation happens on `.with()`, task/event validation happens on call/emit.

## Advanced Patterns

- **Optional dependencies:** mark dependencies as optional (`analytics: analyticsService.optional()`) so the builder injects `null` when the resource is absent.
- **Conditional registration:** `.register((config) => (config.enableFeature ? [featureResource] : []))`.
- **Async coordination:** `Semaphore` (O(1) linked queue for heavy contention) and `Queue` live in the main package. Both use isolated EventManagers internally for their lifecycle events, separate from the global EventManager used for business-level application events.
- **Event safety:** Runner detects event emission cycles and throws an `EventCycleError` with the offending chain.
- **Internal services:** access `globals.resources.store`, `globals.resources.taskRunner`, and `globals.resources.eventManager` for advanced introspection or custom tooling.

## Interop With Classic APIs

Existing code that uses `resource({ ... })`, `task({ ... })`, or `defineX` keeps working. You can gradually migrate:

```ts
import { r, resource as classicResource } from "@bluelibs/runner";

const classic = classicResource({ id: "legacy", init: async () => "ok" });
const modern = r.resource("modern").register([classic]).build();
```
