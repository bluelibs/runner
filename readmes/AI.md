# BlueLibs Runner: Fluent Builder Field Guide

## Resources

```ts
import express from "express";
import { r, run } from "@bluelibs/runner";

const server = r
  .resource<{ port: number }>("server")
  .context(() => ({ app: express(), isReady: true as boolean }))
  .schema(z.object({ port: z.number().default(3000) }))
  .init(async ({ port }, _deps, ctx) => {
    ctx.app.use(express.json());
    const listener = ctx.app.listen(port);
    return { ...ctx, listener };
  })
  .cooldown(async ({ listener }, _config, _deps, ctx) => {
    // Intake stop phase: quickly stop new requests.
    ctx.isReady = false;
    listener.close();
  })
  .dispose(async ({ listener }) => listener.close())
  .build();

const createUser = r
  .task("createUser")
  .dependencies({ logger: r.runner.logger })
  .schema<{ name: string }>({ parse: (value) => value }) // parses the input
  .resultSchema<{ id: string; name: string }>({ parse: (value) => value }) // parses the response
  .run(async (input, { logger }) => {
    await logger.info(`Creating user ${input.name}`);
    return { id: "user-1", name: input.name };
  })
  .build();

const api = r
  .resource("app")
  .register([server.with({ port: 3000 }), createUser])
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

- Built-in resources are also available from `r` for one-import ergonomics (`r.system.*`, `r.runner.*`).

- `.with(config)` exists on configurable built definitions (resources, middleware, tags); fluent builders chain methods plus `.build()`.
- RPC HTTP exposure is owned by `rpcLanesResource.with({ exposure: { http: ... } })` in `mode: "network"`.
- `r.resource<Config>(id)` / `r.task<Input>(id)` seed typing before explicit schema; config-only resources can omit `.init()`.
- Resource lifecycle split: use `cooldown()` to stop ingress quickly at shutdown start, then use `dispose()` for final teardown after runtime drain. `cooldown()` can be async, but should return promptly by contract. Treat it as an ingress hook (HTTP/tRPC/consumer boundaries), not a teardown phase for support resources like databases.
- `r.*.fork(newId, { register: "keep" | "drop" | "deep", reId })` clones a resource under a new id with a separate runtime instance. `"drop"` clears nested items; `"deep"` deep-forks the resource tree and remaps dependencies.
- Dependency maps are fail-fast validated: when `dependencies` is a function, Runner resolves it during bootstrap and it must return an object map (not `null`, array, or primitive).
- `.isolate({ exports: [...] })` narrows visibility: omit = everything public; `exports: []` / `exports: "none"` = nothing public (private subtree). String entries support id selectors with segment wildcard `*` (for example: `app.resources.*`) and must match at least one id at bootstrap.
- `.subtree(policy)` declares owner-scoped subtree policies. Supported branches: `tasks`, `resources`, `hooks`, `taskMiddleware`, `resourceMiddleware`, `events`, `tags`. Each branch supports `validate(definition) => SubtreeViolation[]`; `tasks/resources` also support `middleware: [...]` attachments (see Middleware section for attachment patterns).
- Subtree validators are **return-based**: return `SubtreeViolation[]` from `validate(...)` (do not throw for normal policy failures). Runner aggregates all returned violations and throws one `subtreeValidationFailedError` during bootstrap. If a validator throws or returns a non-array, Runner records an `invalid-definition` violation and still throws the aggregated subtree error.

```ts
import { r, run } from "@bluelibs/runner";

type SubtreeViolation = {
  code: string;
  message: string;
};

const app = r
  .resource("app")
  .subtree({
    tasks: {
      validate: (taskDef): SubtreeViolation[] => {
        if (taskDef.meta?.title) return [];
        return [
          {
            code: "missing-meta-title",
            message: `Task "${taskDef.id}" must define meta.title`,
          },
        ];
      },
    },
  })
  .build();

await run(app); // throws aggregated subtreeValidationFailedError if violations exist
```

- `.isolate({ deny: [...] })` blocks listed ids/tags; `{ only: [...] }` is a boundary-scoped external allowlist (internal subtree items remain reachable). String entries support id selectors with segment wildcard `*` (for example: `app.resources.*.test`). Policies are additive across ancestors (effective external access is the intersection of ancestor `only` lists); Runner fails fast on violations or unmatched selectors at bootstrap.
- Tag object entries and tag-id string entries are intentionally different: `deny: [myTag]` / `only: [myTag]` match the tag dependency and all tagged carriers; `deny: [myTag.id]` / `only: [myTag.id]` match only the exact id string.
- Isolation/visibility enforcement covers dependency wiring plus hook event subscriptions and middleware attachments (task + resource middleware), so the same rules apply to events and middleware too.
- `run(root)` wires dependencies, runs `init`, emits lifecycle events, and returns a runtime object (`IRuntime`) with helpers such as `runTask`, `emitEvent`, `getResourceValue`, `getLazyResourceValue`, `getResourceConfig`, `getRootId`, `getRootConfig`, `getRootValue`, and `dispose`.
- Enable verbose logging with `run(root, { debug: "verbose" })`.
- For a tag-driven backend toolkit example (HTTP + auth + tenancy + MikroORM migrations), see `examples/runner-x/README.md`.

## Tasks

Tasks are your business actions. They are plain async functions with DI, middleware, and validation.

```ts
import { r } from "@bluelibs/runner";

// Assuming: userService, loggingMiddleware, and tracingMiddleware are defined elsewhere
const sendEmail = r
  .task("sendEmail")
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
- Schema resolution precedence is: explicit `parse(input)` schema first; otherwise Runner falls back to pattern validation (`check(...)`).
- Decorator class shorthand is supported across fluent and non-fluent schema APIs (for example `.configSchema(User)`), but class shorthand requires `Match.Schema()` metadata.
- Entry generic `r.task<Input>(id)` / `r.resource<Config>(id)` seeds typing before explicit schema declarations.
- All builders support `.meta({ ... })` for documentation and tooling metadata.
- Strict chain constraints are enforced on `r.*` builders:
  - `task`: after `.run()`, you cannot call `dependencies`, `inputSchema/schema`, `resultSchema`, `middleware`, or `tags`. `.meta()`, `.throws()`, `.build()` remain valid.
  - `hook`: `.run()` is available only after `.on(...)`; after `.run()`, `on`, `dependencies`, and `tags` are locked. `.build()` requires both `.on()` and `.run()`.
  - `task/resource middleware`: after `.run()`, `dependencies`, `configSchema/schema`, and `tags` are locked. `.build()` requires `.run()`.
  - `resource`: after `.init()`, `dependencies`, `configSchema/schema`, `resultSchema`, `middleware`, `tags`, and `context` are locked. `.init()` is optional, and `.build()` remains available.

## Events and Hooks

Events are strongly typed signals. Hooks listen to them with predictable execution order.

```ts
import { r } from "@bluelibs/runner";

const userRegistered = r
  .event("userRegistered")
  .payloadSchema<{ userId: string; email: string }>({ parse: (v) => v })
  .build();

// Type-only alternative (no runtime payload validation):
// const userRegistered = r.event<{ userId: string; email: string }>("userRegistered").build();

// Assuming: userService and sendEmail are defined elsewhere
const registerUser = r
  .task("registerUser")
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
- Wildcard hooks use `.on("*")` and receive every emission except events tagged with `r.runner.tags.excludeFromGlobalHooks`.
- Use `.transactional(true)` on events when listeners must be reversible:
  - Transactional is event metadata (`event.transactional` on emission info), not hook metadata.
  - Every executed listener must return an async undo closure: `async () => { ... }`.
  - If a listener fails, previously completed listeners are rolled back in reverse completion order.
  - Rollback still continues if one undo fails; Runner throws an aggregated transactional rollback error.
  - `run(root)` API is unchanged. This affects hook/listener `run(...)` return behavior for transactional emissions only.
- Transactional constraints (fail-fast runtime sanity checks):
  - `transactional + parallel` is invalid.
  - `transactional + r.runner.tags.eventLane` is invalid.
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

const auditTasks = r.middleware
  .task("audit")
  .dependencies({ logger: r.runner.logger })
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

Attach middleware using `.middleware([auditTasks])` on the definition that owns it. For owner-scoped auto-application, declare middleware in `resource.subtree({ tasks/resources: { middleware: [...] } })` (supports conditional entries via `{ use, when }`).

- Stacking order matters (first listed = outermost wrapper)
- Use `taskRunner.intercept(interceptor, { when? })` for cross-cutting catch-all task interception.
- Contract middleware: middleware can declare `Config`, `Input`, `Output` generics; tasks using it must conform (contracts intersect across `.middleware([...])` and `.tags([...])`). Collisions surface as `InputContractViolationError` / `OutputContractViolationError` in TypeScript; if you add `.inputSchema()`, ensure the schema's inferred type includes the contract shape.
- Entry generic convenience is available for middleware too: `r.middleware.task<Config>(id)` seeds middleware config typing and `r.middleware.resource<Config>(id)` seeds middleware config typing. Use the explicit multi-generic form (`<Config, Input, Output>`) when you need task input/output contracts.

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
import { r, journal } from "@bluelibs/runner";

const abortControllerKey =
  r.runner.middleware.task.timeout.journalKeys.abortController;

// Middleware accesses journal via execution input
const auditMiddleware = r.middleware
  .task("audit")
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
  .run(async (input, deps, { journal, source }) => {
    journal.set(abortControllerKey, new AbortController());
    // Task invocation source metadata: { kind, id }
    const kind = source.kind;
    // To update existing: journal.set(key, newValue, { override: true });
    return "done";
  })
  .build();

// Create custom keys
const myKey = journal.createKey<{ startedAt: Date }>("app.middleware.timing");
```

**Built-in Middleware Journal Keys**: Global middlewares (`retry`, `cache`, `circuitBreaker`, `rateLimit`, `fallback`, `timeout`) expose runtime state via typed journal keys at `r.runner.middleware.task.<name>.journalKeys`. For example, `retry` exposes `attempt` and `lastError`; `cache` exposes `hit`; `circuitBreaker` exposes `state` and `failures`. Access these via `journal.get(key)` without deep imports.

Task `run(..., deps, context)` context includes both `journal` and `source` (both auto-injected): `{ kind: "runtime" | "resource" | "task" | "hook" | "middleware"; id: string }`.

## Tags

Tags let you annotate definitions with metadata that can be queried later.

```ts
import { r } from "@bluelibs/runner";

const httpRouteTag = r
  .tag("app.tags.httpRoute")
  .for(["tasks"]) // optional: restrict where this tag can be attached
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

- Scope tags with `.for([...])` to specific definition kinds (`"tasks"`, `"resources"`, `"events"`, `"hooks"`, `"taskMiddlewares"`, `"resourceMiddlewares"`, `"errors"`). Wrong usage is rejected by TypeScript in `.tags([...])` and also fails fast at runtime (useful when `any`/casts bypass TS).
- Contract tags (a "smart tag"): define type contracts for task input/output (or resource config/value) via `r.tag<TConfig, TInputContract, TOutputContract>(id)`. They don't change runtime behavior; they shape the inferred types and compose with contract middleware.
- Smart tags: built-in tags like `r.system.tags.internal` (id: `system.tags.internal`), `r.runner.tags.debug`, and `r.runner.tags.excludeFromGlobalHooks` change framework behavior.
- Internal container resources are namespaced under `system.*` and accessible through `r.system.*` (`store`, `taskRunner`, `middlewareManager`, `eventManager`, `runtime`); deny them by id selectors such as `.isolate({ deny: ["system.*"] })` when needed.

```ts
type Input = { id: string };
type Output = { name: string };
const userContract = r.tag<void, Input, Output>("contract.user").build();

const getUser = r
  .task("getUser")
  .tags([userContract])
  .run(async (input) => ({ name: input.id }))
  .build();
```

## Cron Scheduling

Use `r.runner.tags.cron` to schedule tasks with cron expressions. The scheduler lives in `r.runner.cron` (alias: `r.runner.cron`), and it is opt-in: cron schedules run only when you explicitly register this resource.

```ts
import { r } from "@bluelibs/runner";

const cleanupTask = r
  .task("app.tasks.cleanup")
  .tags([
    r.runner.tags.cron.with({
      expression: "*/5 * * * *",
      immediate: true,
      onError: "continue",
    }),
  ])
  .run(async () => {
    // cleanup logic
  })
  .build();

const app = r
  .resource("app")
  .register([
    r.runner.cron.with({
      // Optional: restrict scheduling to selected task ids/definitions.
      only: [cleanupTask],
    }),
    cleanupTask,
  ])
  .build();
```

`r.runner.tags.cron.with({...})` options:

- `expression` (required): 5-field cron expression
- `input`: static input passed to the task on each run
- `timezone`: timezone for scheduling
- `immediate`: run once immediately at startup, then continue schedule
- `enabled`: disable schedule when `false`
- `onError`: `"continue"` (default) or `"stop"`
- `silent`: suppress all cron log output for this task when `true` (default `false`)

`r.runner.cron.with({...})` options:

- `only`: optional array of task ids or task definitions; when set, only those cron-tagged tasks are scheduled.

Notes:

- One cron tag per task is supported. If you need multiple schedules, use task forking and tag each fork.
- If `r.runner.cron` is not registered, cron tags are treated as metadata and no schedules are started.
- Cron startup logs are emitted through `r.runner.logger`.
- On `r.system.events.disposing`, cron stops all pending schedules immediately (no new timer-driven runs), while already in-flight cron task executions drain with normal shutdown budgets.

## Async Context

Async Context provides per-request/thread-local state via the platform's `AsyncLocalStorage` (Node, and Deno when `AsyncLocalStorage` is available). Use the fluent builder under `r.asyncContext` or the classic `asyncContext({ ... })` export.

> **Platform Note**: Async Context requires `AsyncLocalStorage`. It is available in Node.js and Deno (when exposed), and unavailable in browser runtimes.

```ts
import { r } from "@bluelibs/runner";

const requestContext = r
  .asyncContext<{ requestId: string }>("app.ctx.request")
  // below is optional
  .configSchema(z.object({ ... }))
  // mostly for remote lane HTTP propagation
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

The global resource `r.runner.queue` (alias: `r.runner.queue`) provides a named queue factory — each `id` gets its own isolated `Queue` instance.

**Key methods:**

- `queue.run(id, task)` — schedule `task` (receives an `AbortSignal`) on the queue identified by `id`; creates the queue lazily.

**Event lifecycle:** `enqueue` → `start` → `finish` | `error`. On disposal: `disposed`. On cancel: `cancel`.

```ts
import { r, run } from "@bluelibs/runner";

const processOrder = r
  .task("processOrder")
  .dependencies({ queue: r.runner.queue })
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

## Remote Lanes (Node)

Remote Lanes connect multiple Runner runtimes through named lanes and topology bindings.

- **Event Lanes**: async fire-and-forget routing for lane-assigned events. Producers enqueue; consumers dequeue and re-emit locally so hooks run on the receiving side. Common adapters: `MemoryEventLaneQueue`, `RabbitMQEventLaneQueue`.
- **RPC Lanes**: synchronous cross-runner task/event calls routed by profile/topology `serve` + binding rules. Use when caller must await result.
- Both lane types support `mode: "network" | "transparent" | "local-simulated"`:
  - `network`: real transport routing
  - `transparent`: bypass transport and run locally
  - `local-simulated`: local serializer/auth simulation boundary
- Lane assignment can be tag-based or explicit with `.applyTo([...])` on lane definitions (`eventLane` or `rpcLane`), and `applyTo` is authoritative when present.
- RPC async-context propagation is explicit allowlist policy via `.asyncContexts([...])`; omitted contexts are not forwarded.

References:

- AI quick reference: `readmes/REMOTE_LANES_AI.md`
- Full guide: `readmes/REMOTE_LANES.md`

## check() and Match (Meteor-inspired)

Use `check(value, patternOrSchema)` for runtime validation.

- Pattern mode: returns the same value (typed by pattern), throws `Match.Error` on mismatch.
- Schema mode: calls `schema.parse(value)` and returns validated output or throws.

Main patterns/helpers:

- Constructors/literals/object/array patterns (`String`, `{ a: String }`, `[String]`, etc.)
- `Match.Any`, `Match.Integer`, `Match.NonEmptyString`, `Match.Email`, `Match.UUID`, `Match.URL`, `Match.IsoDateString`, `Match.RegExp(re)`
- `Match.Optional`, `Match.Maybe`, `Match.OneOf`, `Match.Where`, `Match.ObjectStrict`, `Match.ObjectIncluding`, `Match.MapOf`, `Match.NonEmptyArray`, `Match.ArrayOf`
- `Match.compile(pattern)` and `Match.test(value, pattern)`

Object matching defaults:

- Plain object patterns (for example `{ a: { b: String } }`) are strict by default and equivalent to `Match.ObjectStrict({ ... })`.
- Use `Match.ObjectIncluding({ ... })` when unknown keys must be allowed.
- Use `Match.MapOf(valuePattern)` for dynamic-key records where each value must match the same pattern.

Recursive/class schemas:

- `Match.Lazy(() => pattern)` for recursive/forward references.
- `Match.Schema(options?)` + `Match.Field(pattern)` for optional decorator-based class schemas.
- `Match.Schema({ base: BaseClass | () => BaseClass })` composes class schemas even when classes do not use `extends`.
- `Match.fromSchema(Class, { exact? })` returns a schema-like matcher (default class behavior is ObjectIncluding-style).
- Use `Match.Schema()` + `Match.Field()` when defining a class you control (decorator style); use `Match.fromSchema(Class)` when consuming an existing class or when you need an inline schema without decorators.
- Runtime handles cyclic input graphs for recursive patterns.

JSON Schema (`Match.toJSONSchema(pattern, { strict? })`):

- Draft 2020-12 output.
- Runtime-only patterns (currently `Match.Where` and `Function`) use one shared policy:
  - `strict: false` (default): export permissive metadata nodes with `x-runner-match-kind`.
  - `strict: true`: fail fast (`runner.errors.check.jsonSchemaUnsupportedPattern`).
- `Match.RegExp(re)` exports `type: "string"` + `pattern: re.source`; flags are exported as metadata.
- `Match.fromSchema(...)` exports recursive class graphs via `$defs/$ref`.
- `Match.ObjectStrict(...)` exports strict object schemas (`additionalProperties: false`).
- `Match.MapOf(...)` exports dictionary schemas via `additionalProperties: <value schema>`.

## Errors

Define typed, namespaced errors with a fluent builder. Built helpers expose `new`, `create` (alias), `throw`, and `is`:

```ts
import { r } from "@bluelibs/runner";

// Fluent builder
const AppError = r
  .error<{ code: number; message: string }>("AppError")
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

Override a task/resource/hook/middleware while preserving `id`:

```ts
const mockMailer = r.override(realMailer, async () => new MockMailer());

const app = r
  .resource("app")
  .register([realMailer])
  .overrides([mockMailer])
  .build();
```

- `r.override(base, fn)` is a typed shorthand for common behavior swaps:
  - task/hook/task-middleware/resource-middleware: replaces `run`
  - resource: replaces `init`
- `override(base, fn)` is an alias with the same behavior as `r.override(base, fn)`.
- `r.override(...)` creates replacement definitions; `.overrides([...])` applies them in a specific container during bootstrap.
- `.overrides([...])` accepts only definitions produced by `r.override(...)` / `override(...)` (plus `null` / `undefined`).
- Registering only the replacement definition is valid; registering both base and replacement in `.register([...])` causes duplicate-id errors.
- `.overrides([...])` requires the target id to already be present in the graph; if you wanted a second resource instance instead of replacement, use `.fork("new.id")`.
- Hook overrides keep the same `.on` target; shorthand only replaces `run`.
- Boundary/topology changes are not override concerns; use `.fork("new.id")` for separate instances.

## Runtime & Lifecycle

- `run(root, options)` wires dependencies, initializes resources, and returns the runtime object: `runTask`, `emitEvent`, `getResourceValue`, `getLazyResourceValue`, `getResourceConfig`, `getRootId`, `getRootConfig`, `getRootValue`, `store`, `logger`, and `dispose`. `getLazyResourceValue` is available only when `run(..., { lazy: true })` is enabled.
- `emitEvent(event, payload, options?)` accepts the same emission options (`failureMode`, `throwOnError`, `report`) as dependency emitters.
- `.isolate({ exports: [...] })` on the root restricts `runTask`, `emitEvent`, `getResourceValue`, and `getLazyResourceValue` to exported ids; omit for full open surface.
- Run options: `debug` (normal/verbose), `logs`, `errorBoundary`, `shutdownHooks`, `disposeBudgetMs` (total), `disposeDrainBudgetMs` (drain wait), `dryRun`, `lazy`, `lifecycleMode` (`"sequential"` or `"parallel"`).
- Startup: wire deps → init resources (dependency order) → emit `r.system.events.ready` → return runtime. Signals during bootstrap cancel and roll back.
- Shutdown phases: (1) `cooldown()` on resources (reverse dep order) — fast ingress stop; (2) emit `r.system.events.disposing`; (3) drain in-flight tasks/events up to `disposeDrainBudgetMs`; (4) transition to `drained`, emit `r.system.events.drained`, block new admissions; (5) `dispose()` resources with remaining budget.
- Lifecycle usage reminder: use `cooldown()` for ingress stop and `dispose()` for final teardown (see Resources section for the contract details).
- Event source model: `IEventEmission.source` is object-based end-to-end: `{ kind: "runtime" | "resource" | "task" | "hook" | "middleware"; id: string }`.
- Task interceptors: inside resource init, call `deps.someTask.intercept(async (next, input) => next(input))` to wrap a single task execution at runtime.

## Reliability & Performance

- **Concurrency**: Limit parallel execution using a shared or local `Semaphore`.
  ```ts
  .middleware([r.runner.middleware.task.concurrency.with({ limit: 5 })])
  ```
- **Circuit Breaker**: Trip after failures to prevent cascading downstream pressure.
  ```ts
  .middleware([r.runner.middleware.task.circuitBreaker.with({ failureThreshold: 5, resetTimeout: 30000 })])
  ```
- **Rate Limit**: Protect APIs with fixed-window request counting.
  ```ts
  .middleware([r.runner.middleware.task.rateLimit.with({ windowMs: 60000, max: 100 })])
  ```
- **Temporal (Debounce/Throttle)**: Control execution frequency.
  ```ts
  .middleware([r.runner.middleware.task.debounce.with({ ms: 300 })])
  ```
- **Fallback**: Provide a Plan B (value, function, or another task) when the primary fails.
  ```ts
  // Recommended: Fallback should be outer (on top) of Retry to catch final failures
  .middleware([
    r.runner.middleware.task.fallback.with({ fallback: "Guest User" }),
    r.runner.middleware.task.retry.with({ attempts: 3 })
  ])
  ```
- **Retry/Backoff**: `r.runner.middleware.task.retry` and `r.runner.middleware.resource.retry` for transient failures.
  ```ts
  .middleware([r.runner.middleware.task.retry.with({ retries: 3 })])
  ```
- **Caching**: `r.runner.middleware.task.cache` plus `r.runner.cache`.
  ```ts
  .middleware([r.runner.middleware.task.cache.with({ ttl: 60000 })])
  ```
- **Timeouts**: `r.runner.middleware.task.timeout` / `r.runner.middleware.resource.timeout` using `AbortController`.
  ```ts
  .middleware([r.runner.middleware.task.timeout.with({ ttl: 5000 })])
  ```
- **Logging & Debug**: `r.runner.logger` and `r.runner.debug`.
  ```ts
  // Verbose debug logging for a specific task
  .tags([r.runner.tags.debug])
  ```

## Serialization

Runner ships with a serializer that round-trips Dates, RegExp, binary, and custom shapes across Node and web.

Register custom types via `serializer.addType({ id, is, serialize, deserialize, strategy })` (inject `r.runner.serializer`). Use `new Serializer()` for a standalone instance.

Schema-aware deserialization is available via `deserialize(payload, { schema })` (or `parse(payload, { schema })`):

- Decorated classes support shorthand: `schema: User` and `schema: [User]` when the class has `@Match.Schema()` metadata.
- If a class is not decorated with `@Match.Schema()`, constructor shorthand keeps constructor semantics (`instanceof`), which usually fails for plain deserialized objects.
- Schema-like parsers support shorthand arrays: `schema: [mySchema]`.
- Use `schema: Match.fromSchema(User)` for class-backed contracts.
- For arrays, use `schema: Match.ArrayOf(Match.fromSchema(User))`.
- Prefer explicit entry schemas at trust boundaries.

Serializer field remapping is available via `Serializer.Field(...)` on class properties:

- `Serializer.Field({ from: "abc" })` maps inbound/outbound key aliases for class instances.
- `Serializer.Field({ serialize, deserialize })` applies per-field value transforms.
- Metadata resolution is cached per class constructor (no repeated reflection-like scanning per call).

Note: file uploads use `createWebFile`/`createNodeFile` — handled by HTTP RPC transport, not the serializer.

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
- `r.runner.logger` exposes the framework logger; register your own logger resource and override it at the root to capture logs centrally.
- Hooks and tasks emit metadata through `r.system.store`. Query it for dashboards or editor plugins.
- Use middleware for tracing (`r.middleware.task("...").run(...)`) to wrap every task call.

## Namespacing & IDs

- Meta: `.meta({ title, description })` on tasks/resources/events/middleware for human-friendly docs and tooling; extend meta types via module augmentation when needed.
- Scoped names: definitions can use local names when registered under a resource subtree (for example `task("createUser")` under `resource("app")`).
- Prefer local names in definitions (`task("createUser")`, `event("userRegistered")`); `run()` composes canonical IDs from ownership automatically.
- Canonical runtime IDs are compiled from the owner subtree:
  - task `createUser` -> `app.tasks.createUser`
  - event `userRegistered` -> `app.events.userRegistered`
  - resource `db` -> `app.db` (nested registers inherit 'app.db' as prefix)
  - hook `onUserRegistered` -> `app.hooks.onUserRegistered`
  - task middleware `auth` -> `app.middleware.task.auth`
  - resource middleware `audit` -> `app.middleware.resource.audit`
  - tag `public` -> `app.tags.public`
  - error `InvalidInput` -> `app.errors.InvalidInput`
  - async context `request` -> `app.ctx.request`
- Runtime/store internals always expose canonical IDs (`definition.id`), while original definition objects remain unchanged.
- Fail-fast reserved local names: `tasks`, `resources`, `events`, `hooks`, `tags`, `errors`, `ctx`.
- Fail-fast id shape checks are centralized for all definition types: ids cannot start/end with `.`, cannot contain `..`, and cannot be a reserved standalone local name.
- Fully qualified IDs (any id containing a `.`) are treated as absolute: they bypass parent prefixing entirely. The detection is simple — if `id.includes(".")`, it stays as-is. This means a child resource can escape its parent's namespace (e.g., `resource("runner-dev.resources.dev")` registered under `root` keeps its own namespace instead of becoming `root.runner-dev.resources.dev`). This is intentional for library/framework resources that own their own namespace.
- Runtime validation: `inputSchema`, `resultSchema`, `payloadSchema`, `configSchema` share the same `parse(input)` contract; config validation happens on `.with()`, task/event validation happens on call/emit. Use `.schema()` as a unified alias (input/payload/schema/data) for simplicity.

## File Structure

- Prefer co-locating definitions by domain in a feature-driven folder structure (for example: `src/domains/users/tasks/createUser.task.ts`).
- Prefer naming files by item type (`*.task.ts`, `*.resource.ts`, `*.event.ts`) for fast navigation and better AI retrieval.

## Advanced Patterns

- **Optional dependencies:** `analytics: analyticsService.optional()` injects `undefined` when the resource is absent.
- **Conditional registration:** `.register((config) => (config.enableFeature ? [featureResource] : []))`.
- **Event safety:** Runner detects event emission cycles and throws an `EventCycleError` with the offending chain.
- **Internal runtime:** `r.system.runtime` (alias: `r.system.runtime`) resolves to the same `IRuntime` returned by `run(...)`. When injected inside `init()`, only that resource's dependencies are guaranteed initialized.
