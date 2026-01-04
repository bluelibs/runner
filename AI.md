# BlueLibs Runner: Fluent Builder Field Guide

> Token-friendly (<5000 tokens). This guide spotlights the fluent builder API (`r.*`) that ships with Runner 4.x. Classic `defineX` / `resource({...})` remain supported for backwards compatibility, but fluent builders are the default throughout.

## Table of Contents

- [BlueLibs Runner: Fluent Builder Field Guide](#bluelibs-runner-fluent-builder-field-guide)
  - [Table of Contents](#table-of-contents)
  - [Install](#install)
  - [Resources](#resources)
    - [Tasks](#tasks)
    - [Events and Hooks](#events-and-hooks)
    - [Middleware](#middleware)
    - [Tags](#tags)
    - [Async Context](#async-context)
    - [Errors](#errors)
  - [HTTP \& Tunnels](#http--tunnels)
    - [HTTP Client Factory (Recommended)](#http-client-factory-recommended)
    - [Direct Client Creation (Legacy)](#direct-client-creation-legacy)
  - [Serialization](#serialization)
  - [Testing](#testing)
  - [Observability \& Debugging](#observability--debugging)
  - [Advanced Patterns](#advanced-patterns)
  - [Interop With Classic APIs](#interop-with-classic-apis)

## Install

```bash
npm install @bluelibs/runner
```

## Durable Workflows

Durable workflows are a **Node-only** module exported from `@bluelibs/runner/node` (implemented under `src/node/durable/`).

- Spec & guide: `readmes/DURABLE_WORKFLOWS.md`
- Token-friendly durable guide: `readmes/DURABLE_WORKFLOWS_AI.md`
- Core primitives: `ctx.step(id, fn)`, `ctx.sleep(ms)`, `ctx.emit(event, payload)`, `ctx.waitForSignal(signal)` and `durable.signal(executionId, signal, payload)`
- `waitForSignal` return shapes:
  - `waitForSignal(signal)` or `waitForSignal(signal, { stepId })` => payload (throws on timeout)
  - `waitForSignal(signal, { timeoutMs })` => `{ kind: "signal" | "timeout" }` (stepId does not change the return type)
- Note: `waitForSignal(signal, { stepId })` requires a store that supports listing step results (`listStepResults`) so `durable.signal(...)` can resume the correct waiter.
- Semantics: repeated `emit` and repeated `waitForSignal` (same signal id) are supported and replay-safe (see the guides for details)
- Determinism: internal `sleep()`/`emit()`/`waitForSignal()` step ids use call-order indexes by default; prefer explicit `{ stepId }` (or set `determinism.implicitInternalStepIds` to `"warn"`/`"error"`)
- Type-safety helpers: `createDurableStepId<T>()`, `createDurableSignalId<TPayload>()`, and `durable.executeStrict(...)`
- Polling: used for timers (`sleep`, signal timeouts, schedules); can be disabled per-process via `polling: { enabled: false }`
- Scheduling: one-time (`{ at }` / `{ delay }`) and recurring (`{ cron }` / `{ interval }`) via `durable.schedule(...)` + `pauseSchedule/resumeSchedule/updateSchedule/removeSchedule`
- Observability: optional audit trail via `audit: { enabled: true }` + `ctx.note(...)` + `store.listAuditEntries(executionId)`
- Events/logging: in Runner integration (`durableResource`), workflow lifecycle events are emitted via `durableEvents.*` by default; hook `durableEvents.audit.appended` to log/mirror
- Dashboard UI: `createDashboardMiddleware(service, new DurableOperator(store))` exposes `/api/*` + a bundled UI for inspecting executions (from source: build via `npm run build:dashboard`)
- Advanced config: `workerId` (distributed timer claims), `polling.claimTtlMs`, `taskResolver` (resolve tasks by id), `contextProvider` (AsyncLocalStorage-style context)
- Recovery scalability: `RedisStore` maintains `durable:active_executions` so `recover()`/`listIncompleteExecutions()` are O(active) (no full history scan)
- Queue failsafe: when a queue is configured, `startExecution()` arms a short-lived store timer (default 10s) so a transient enqueue failure can't strand an execution in `pending` (`execution.kickoffFailsafeDelayMs`)

### Runner Integration Patterns (Real-World)

**Single-process (local dev / tests)**: run the durable resource + tasks in the same Runner runtime.

```ts
	import { r, run } from "@bluelibs/runner";
	import {
	  MemoryStore,
	  MemoryQueue,
	  MemoryEventBus,
	  durableResource,
	} from "@bluelibs/runner/node";

	const store = new MemoryStore();
	const queue = new MemoryQueue();
	const eventBus = new MemoryEventBus();

	const durable = durableResource.fork("app.durable");
	const durableRegistration = durable.with({
	  store,
	  queue,
	  eventBus,
	  worker: true, // consumes the queue in this process
	});

	const processOrder = r
	  .task("app.tasks.processOrder")
	  .dependencies({ durable })
	  .run(async (input: { orderId: string }, { durable }) => {
	    const ctx = durable.use();
	    await ctx.step("validate", async () => ({ ok: true }));
	    return { ok: true };
	  })
	  .build();

	const app = r
	  .resource("app")
	  .register([durableRegistration, processOrder])
	  .build();

	const runtime = await run(app);
	const d = runtime.getResourceValue(durable);
```

**Multi-process (production)**: run N worker processes that consume the queue and process executions.

- Worker processes register the same durable resource with `worker: true`.
- API processes usually **should not** run the durable poller/worker; configure `worker: false` + `polling: { enabled: false }`.

Concrete approach with Runner itself:
- Add a small “durable API” task (eg `app.durable.startOrder`) that calls `durable.startExecution(...)` and persists the returned `executionId` into your DB.
- Add webhook/callback handlers that look up `executionId` from your DB and call `durable.signal(executionId, ...)`.

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

Use `.fork(newId)` to create multiple instances of a "template" resource with different identities:

```ts
// Define a reusable template
const mailerBase = r.resource<{ smtp: string }>("base.mailer")
  .init(async (cfg) => new Mailer(cfg))
  .build();

// Fork with distinct identities - export these for dependency use
export const txMailer = mailerBase.fork("app.mailers.transactional");
export const mktMailer = mailerBase.fork("app.mailers.marketing");

// Use forked resources as dependencies
const orderService = r.task("app.tasks.processOrder")
  .dependencies({ mailer: txMailer })
  .run(async (input, { mailer }) => { /* ... */ })
  .build();

const app = r.resource("app")
  .register([
    txMailer.with({ smtp: "tx.smtp.com" }),
    mktMailer.with({ smtp: "mkt.smtp.com" }),
    orderService,
  ])
  .build();
```

- Forked resources inherit tags, middleware, and all type parameters.
- Each fork gets its own runtime instance (no shared state).

### Tasks

Tasks are your business actions. They are plain async functions with DI, middleware, and validation.

```ts
import { r } from "@bluelibs/runner";

const sendEmail = r
  .task("app.tasks.sendEmail")
  .inputSchema<{ to: string; subject: string; body: string }>({
    parse: (value) => value,
  })
  .dependencies({ emailer: userService })
  .middleware((config) => [
    loggingMiddleware.with({ label: "email" }),
    tracingMiddleware,
  ])
  .run(async (input, { emailer }) => {
    await emailer.send(input);
    return { delivered: true };
  })
  .build();
```

- `.dependencies()` accepts a literal map or a function `(config) => deps`.
- `.middleware()` appends by default; pass `{ override: true }` to replace. `.tags()` replaces the list each time.
- `.dependencies()` appends (shallow-merge) by default on resources, tasks, hooks, and middleware; pass `{ override: true }` to replace. Functions and objects are merged consistently.
- Provide result validation with `.resultSchema()` when the function returns structured data.

### Events and Hooks

Events are strongly typed signals. Hooks listen to them with predictable execution order.

```ts
import { r } from "@bluelibs/runner";

const userRegistered = r
  .event("app.events.userRegistered")
  .payloadSchema<{ userId: string; email: string }>({ parse: (v) => v })
  .build();

// Type-only alternative (no runtime payload validation):
// const userRegistered = r.event<{ userId: string; email: string }>("app.events.userRegistered").build();

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
    await mailer({ to: event.data.email, subject: "Welcome", body: "🎉" });
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

### Middleware

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

### Tags

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

### Async Context

Async Context provides per-request/thread-local state via the platform's `AsyncLocalStorage` (Node). Use the fluent builder under `r.asyncContext` or the classic `asyncContext({ ... })` export.

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

### Errors

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

## HTTP & Tunnels

Run Node exposures and connect to remote Runners with fluent resources.

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

### Direct Client Creation (Legacy)

You can also create clients directly without DI (manual serializer/error/context passing):

```ts
import { createHttpClient } from "@bluelibs/runner";
import { createFile as createWebFile } from "@bluelibs/runner/platform/createFile";

const client = createHttpClient({
  baseUrl: "/__runner",
  auth: { token: "secret" },
  serializer: JSON,
});

await client.task("app.tasks.getHealth");

const file = createWebFile({ name: "notes.txt" }, new Blob(["Hello"]));
await client.task("app.tasks.upload", { file });
```

- `createHttpSmartClient` (Node only) supports duplex streams.
- For Node-specific features such as `useExposureContext` for handling aborts and streaming in exposed tasks, see TUNNELS.md.
- Register authentication middleware or rate limiting on the exposure via middleware tags and filters.
- Single-owner policy: a task may be tunneled by exactly one tunnel resource. Runner enforces exclusivity at init time and throws if two tunnels select the same task. This is tracked via an internal symbol on the task linking it to the owning tunnel.
- Architecture/testing deep dive: see `readmes/TUNNELS.md` sections 2.1 and 11.

## Serialization

Runner ships with a serializer that round-trips Dates, RegExp, binary, and custom shapes across Node and web.

```ts
import { r, globals } from "@bluelibs/runner";

const serializerSetup = r
  .resource("app.serialization")
  .dependencies({ serializer: globals.resources.serializer })
  .init(async (_config, { serializer }) => {
    class Distance {
      constructor(public value: number, public unit: string) {}
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

Note on files: The “File” you see in tunnels is not a custom serializer type. Runner uses a dedicated `$ejson: "File"` sentinel in inputs which the tunnel client/server convert to multipart streams via a manifest. File handling is performed by the tunnel layer (manifest hydration and multipart), not by the serializer. Keep using `createWebFile`/`createNodeFile` for uploads.

## Testing

- Use `npm run coverage:ai` to execute the full Jest suite in a token-friendly format (includes per-file missed statement/branch/line locations when coverage < 100%). Focused tests can run via `npm run test -- some.test.ts`.
- Durable workflows are included in the normal test suite (`npm test`). For focused runs use `npm run test -- durable` or `npm run coverage:durable:ai`.
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

## Advanced Patterns

- **Optional dependencies:** mark dependencies as optional (`analytics: analyticsService.optional()`) so the builder injects `null` when the resource is absent.
- **Conditional registration:** `.register((config) => (config.enableFeature ? [featureResource] : []))`.
- **Async coordination:** `Semaphore` (O(1) linked queue for heavy contention) and `Queue` live in the main package. Both use isolated EventManagers internally for their lifecycle events, separate from the global EventManager used for business-level application events.
- **Event safety:** Runner detects event emission cycles and throws an `EventCycleError` with the offending chain.

## Interop With Classic APIs

Existing code that uses `resource({ ... })`, `task({ ... })`, or `defineX` keeps working. You can gradually migrate:

```ts
import { r, resource as classicResource } from "@bluelibs/runner";

const classic = classicResource({ id: "legacy", init: async () => "ok" });
const modern = r.resource("modern").register([classic]).build();
```

Fluent builders produce the exact same runtime definitions, so you can mix both styles within one project.
