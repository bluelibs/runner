# BlueLibs Runner: Fluent Builder Field Guide

## Resources

```ts
import express from "express";
import { r, run, globals } from "@bluelibs/runner";
import { nodeExposure } from "@bluelibs/runner/node";

const server = r
  .resource<{ port: number }>("app.server")
  .context(() => ({ app: express() }))
  .schema(z.object({ port: z.number().default(3000) }))
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
  .schema<{ name: string }>({ parse: (value) => value }) // parses the input
  .resultSchema<{ id: string; name: string }>({ parse: (value) => value }) // parses the response
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

- `.with(config)` exists on configurable built definitions (resources, middleware, tags); fluent builders chain methods plus `.build()`.
- Fluent `.build()` outputs are deep-frozen (immutable); so are `.with(config)` and `.fork(...)` outputs.
- `r.resource<Config>(id)` / `r.task<Input>(id)` seed typing before explicit schema; config-only resources can omit `.init()`.
- `r.*.fork(newId, { register: "keep" | "drop" | "deep", reId })` clones a resource under a new id with a separate runtime instance. `"drop"` clears nested items; `"deep"` deep-forks the resource tree and remaps dependencies.
- `.exports([...])` narrows visibility: omit = everything public; `.exports([])` = nothing public (private subtree, including `.everywhere()` scope).
- `.wiringAccessPolicy({ deny: [...] })` blocks listed ids/tags; `{ only: [...] }` is the allowlist form. Policies are additive across ancestors; Runner fails fast on violations at bootstrap.
- `run(root)` wires dependencies, runs `init`, emits lifecycle events, and returns a runtime object (`IRuntime`) with helpers such as `runTask`, `emitEvent`, `getResourceValue`, `getLazyResourceValue`, `getResourceConfig`, `getRootId`, `getRootConfig`, `getRootValue`, and `dispose`.
- Enable verbose logging with `run(root, { debug: "verbose" })`.

## Tasks

Tasks are your business actions. They are plain async functions with DI, middleware, and validation.

```ts
import { r } from "@bluelibs/runner";

// Assuming: userService, loggingMiddleware, and tracingMiddleware are defined elsewhere
const sendEmail = r
  .task("app.tasks.sendEmail")
  .schema<{ to: string; subject: string; body: string }>({
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

- All list builders (`dependencies`, `middleware`, `tags`, `register`, `overrides`, `exports`) append by default; pass `{ override: true }` to replace.
- `.schema()` is a unified alias for `inputSchema`, `configSchema`, `payloadSchema`, and `dataSchema` (errors). For tasks, maps to `inputSchema` only; use `.resultSchema()` for output validation.
- Entry generic `r.task<Input>(id)` / `r.resource<Config>(id)` seeds typing before explicit schema declarations.
- All builders support `.meta({ ... })` for documentation and tooling metadata.

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

- Use `.on(onAnyOf(...))` to listen to several events while keeping inference. Import `onAnyOf` from `@bluelibs/runner/defs` (or `@bluelibs/runner` if you already re-export it in your local facade).
- Hooks can set `.order(priority)`; lower numbers run first. Call `event.stopPropagation()` inside `run` to cancel downstream hooks.
- Wildcard hooks use `.on("*")` and receive every emission except events tagged with `globals.tags.excludeFromGlobalHooks`.
- Use `.parallel(true)` on event definitions: same-`order` listeners run concurrently, batches execute sequentially by ascending priority; if any batch throws, subsequent batches are skipped.
- Event emitters (dependency-injected or `runtime.emitEvent`) support options:
  - `failureMode: "fail-fast" | "aggregate"`
  - `throwOnError` (default `true`)
  - `report` (when `true`, returns `IEventEmitReport`)
- Pass `{ report: true, throwOnError: false, failureMode: "aggregate" }` to get an `IEventEmitReport` (with `failedListeners`) instead of throwing.

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
- Entry generic convenience is available for middleware too: `r.middleware.task<Input>(id)` seeds task input contract typing and `r.middleware.resource<Config>(id)` seeds middleware config typing. The explicit multi-generic form (`<Config, Input, Output>`) remains available.

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

Retrieve tagged items by depending on the tag directly. Runner injects a typed accessor with `tasks`, `resources`, `events`, `hooks`, `taskMiddlewares`, `resourceMiddlewares`, and `errors`.

```ts
const inspectRoutes = r
  .task("app.tasks.inspectRoutes")
  .dependencies({ httpRouteTag })
  .run(async (_input, { httpRouteTag }) => {
    return httpRouteTag.tasks.map((entry) => ({
      id: entry.definition.id,
      config: entry.config,
    }));
  })
  .build();
```

Use `tag.startup()` when startup ordering matters; treat that accessor as metadata-first (runtime helpers like `tasks[].run` may be unavailable there).

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

## Cron Scheduling

Use `globals.tags.cron` to schedule tasks with cron expressions. The scheduler lives in `globals.resources.cron` and is registered by default, so tagged tasks begin scheduling automatically at runtime startup.

```ts
import { r, globals } from "@bluelibs/runner";

const cleanupTask = r
  .task("app.tasks.cleanup")
  .tags([
    globals.tags.cron.with({
      expression: "*/5 * * * *",
      immediate: true,
      onError: "continue",
    }),
  ])
  .run(async () => {
    // cleanup logic
  })
  .build();

const app = r.resource("app").register([cleanupTask]).build();
```

`globals.tags.cron.with({...})` options:

- `expression` (required): 5-field cron expression
- `input`: static input passed to the task on each run
- `timezone`: timezone for scheduling
- `immediate`: run once immediately at startup, then continue schedule
- `enabled`: disable schedule when `false`
- `onError`: `"continue"` (default) or `"stop"`
- `silent`: suppress all cron log output for this task when `true` (default `false`)

Notes:

- One cron tag per task is supported. If you need multiple schedules, use task forking and tag each fork.
- Cron startup logs are emitted through `globals.resources.logger`.

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

Define typed, namespaced errors with a fluent builder. Built helpers expose `new`, `create` (alias), `throw`, and `is`:

```ts
import { r } from "@bluelibs/runner";

// Fluent builder
const AppError = r
  .error<{ code: number; message: string }>("app.errors.AppError")
  .httpCode(400)
  // .schema is an alias for .dataSchema in errors
  .schema(z.object({ code: z.number(), message: z.string() }))
  .format((d) => `[${d.code}] ${d.message}`)
  .remediation("Check the request payload and retry with valid data.")
  .tags([criticalTag])
  .build();

try {
  AppError.throw({ code: 400, message: "Oops" });
} catch (err) {
  if (AppError.is(err, { code: 400 })) {
    // err.httpCode -> 400, err.message includes remediation
  }
}

const error = AppError.new({ code: 400, message: "Oops" });
throw error;
```

- Recommended ids: `{domain}.errors.{PascalCaseName}` (for example: `app.errors.InvalidCredentials`).
- The thrown `Error` has `name = id` and `message = format(data)` (default: `JSON.stringify(data)`).
- `.httpCode(number)` sets an HTTP status on the error helper and thrown instances.
- `.remediation(stringOrFn)` attaches fix-it advice appended to `error.message`; raw text also at `error.remediation`.
- `helper.new(data)` constructs and returns a typed `RunnerError` without throwing.
- `helper.is(err, partialData?)` performs shallow strict matching (`===`) on each provided key.
- Declare a task/resource error contract with `.throws([AppError])` (or ids). Declarative only, does not imply DI. Available on hooks and middleware builders too.
- Use `r.error.is(err)` to check if an error is _any_ Runner error (not just a specific one). This type guard narrows to `RunnerError` with `id`, `data`, `httpCode`, and `remediation` properties. Useful in catch blocks or error filters:
  ```ts
  if (r.error.is(err, { code: 400 })) {
    console.error(`Runner error: ${err.id} (${err.httpCode || "N/A"})`);
  }
  ```

## Overrides

Override a task/resource/hook/middleware while preserving `id`. Use the helper or the fluent override builder:

```ts
const mockMailer = r.override(realMailer, async () => new MockMailer());

const tracedMailer = r
  .override(realMailer)
  .init(async (config, deps) => {
    const base = await realMailer.init(config, deps);
    return { ...base, trace: true };
  })
  .build();

const app = r
  .resource("app")
  .register([realMailer])
  .overrides([mockMailer, tracedMailer])
  .build();
```

- `r.override(base, fn)` is a typed shorthand for common behavior swaps:
  - task/hook/task-middleware/resource-middleware: replaces `run`
  - resource: replaces `init`
- `r.override(base)` starts from the base definition and applies fluent mutations using the same composition rules as the base builder.
- `r.override(...)` creates replacement definitions; `.overrides([...])` applies them in a specific container during bootstrap.
- Registering only the replacement definition is valid; registering both base and replacement in `.register([...])` causes duplicate-id errors.
- `.overrides([...])` requires the target id to already be present in the graph; if you wanted a second resource instance instead of replacement, use `.fork("new.id")`.
- Hook overrides keep the same `.on` target; only behavior/metadata is overridable.

## Runtime & Lifecycle

- `run(root, options)` wires dependencies, initializes resources, and returns the runtime object: `runTask`, `emitEvent`, `getResourceValue`, `getLazyResourceValue`, `getResourceConfig`, `getRootId`, `getRootConfig`, `getRootValue`, `store`, `logger`, and `dispose`. `getLazyResourceValue` is available only when `run(..., { lazy: true })` is enabled.
- `emitEvent(event, payload, options?)` accepts the same emission options (`failureMode`, `throwOnError`, `report`) as dependency emitters.
- `.exports([...])` on the root restricts `runTask`, `emitEvent`, `getResourceValue` to exported ids; omit for full open surface.
- Run options highlights: `debug` (normal/verbose), `logs`, `errorBoundary`, `shutdownHooks`, `dryRun`, `lazy`, `initMode` (`"sequential"` or `"parallel"`).
- Task interceptors: inside resource init, call `deps.someTask.intercept(async (next, input) => next(input))` to wrap a single task execution at runtime.

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

## Serialization

Runner ships with a serializer that round-trips Dates, RegExp, binary, and custom shapes across Node and web.

Register custom types via `serializer.addType({ id, is, serialize, deserialize, strategy })` (inject `globals.resources.serializer`). Use `new Serializer()` for a standalone instance.

Note: file uploads use `createWebFile`/`createNodeFile` — handled by the tunnel layer, not the serializer.

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

## Metadata & Namespacing

- Meta: `.meta({ title, description })` on tasks/resources/events/middleware for human-friendly docs and tooling; extend meta types via module augmentation when needed.
- Namespacing: keep ids consistent with `domain.resources.name`, `domain.tasks.name`, `domain.events.name`, `domain.hooks.on-name`, `domain.middleware.{task|resource}.name`, `domain.errors.ErrorName`, and `domain.ctx.name`.
- File Structure: While not strictly enforced, prefer co-locating definitions by domain in a feature-driven folder structure (e.g., `src/domains/users/tasks/createUser.task.ts`) and naming files after the item type (`*.task.ts`, `*.resource.ts`, `*.event.ts`) for easier navigation and AI context ingestion.
- Runtime validation: `inputSchema`, `resultSchema`, `payloadSchema`, `configSchema` share the same `parse(input)` contract; config validation happens on `.with()`, task/event validation happens on call/emit. Use `.schema()` as a unified alias (input/payload/schema/data) for simplicity.

## Advanced Patterns

- **Optional dependencies:** `analytics: analyticsService.optional()` injects `undefined` when the resource is absent.
- **Conditional registration:** `.register((config) => (config.enableFeature ? [featureResource] : []))`.
- **Event safety:** Runner detects event emission cycles and throws an `EventCycleError` with the offending chain.
- **Internal runtime:** `globals.resources.runtime` resolves to the same `IRuntime` returned by `run(...)`. When injected inside `init()`, only that resource's dependencies are guaranteed initialized.
