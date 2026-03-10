# BlueLibs Runner: AI Field Guide

Runner is a strongly typed application composition framework built around explicit contracts. Think of it as a graph of definitions: resources model long-lived services and lifecycle, tasks model business actions, events and hooks model decoupled reactions, middleware models cross-cutting behavior, and tags model discovery and policy. The point is not "just run some code", but to declare what exists, what depends on what, what gets validated, and how the whole system starts, runs, pauses, and shuts down.

It treats architecture as runtime-enforced structure rather than team convention. Dependency injection is explicit, validation is first-class, isolation boundaries are part of the model, and lifecycle phases are deliberate. So instead of building an app out of loosely connected modules, you build a constrained execution graph where contracts, composition, and operational behavior are visible and testable from the start.

**Reading order for agents:** start with the Mental Model below, then Quick Start, then the section matching your task. For full documentation, see the [FULL_GUIDE.md](./FULL_GUIDE.md). For Node-specific features (Async Context, Durable Workflows, Remote Lanes), see the dedicated readmes linked at the end.

## Mental Model

- `resource`: a singleton with lifecycle (`init`, `ready`, `cooldown`, `dispose`)
- `task`: a typed business action with DI, middleware, and validation
- `event`: a typed signal
- `hook`: a listener for an event
- `middleware`: a wrapper around a task or resource
- `tag`: metadata you can attach and query later
- `error`: a typed Runner error helper
- `run(app)`: bootstraps the graph and returns the runtime API

Prefer the flat globals for built-ins:

- `resources.*`
- `events.*`
- `tags.*`
- `middleware.*`
- `debug.levels`

## Quick Start

```ts
import { resources, r, run } from "@bluelibs/runner";

const userCreated = r
  .event<{ id: string; email: string }>("userCreated")
  .build();

const userStore = r
  .resource("userStore")
  .init(async () => new Map<string, { id: string; email: string }>())
  .build();

const createUser = r
  .task<{ email: string }>("createUser")
  .dependencies({
    userCreated,
    userStore,
    logger: resources.logger,
  })
  .run(async (input, deps) => {
    const user = { id: "user-1", email: input.email };

    deps.userStore.set(user.id, user);
    await deps.logger.info(`Created user ${user.email}`);
    await deps.userCreated(user);

    return user;
  })
  .build();

const sendWelcomeEmail = r
  .hook("sendWelcomeEmail")
  .on(userCreated)
  .run(async (event) => {
    console.log(`Welcome ${event.data.email}`);
  })
  .build();

const app = r
  .resource("app")
  .register([userStore, createUser, sendWelcomeEmail])
  .build();

const runtime = await run(app);

await runtime.runTask(createUser, { email: "ada@example.com" });
await runtime.dispose();
```

## Core Builder Rules and IDs

- Fluent builders chain methods and end with `.build()`.
- Configurable built definitions expose `.with(config)`.
- `r.task<Input>(id)` and `r.resource<Config>(id)` seed typing before explicit schemas.
- User-specified definition ids are local ids and cannot contain `.`. Use `send-email`, not `app.tasks.sendEmail`.
- Dotted `runner.*` and `system.*` ids are reserved for framework-owned internals.
- `.schema()` is the unified alias:
  - task -> input schema
  - resource -> config schema
  - event -> payload schema
  - error -> data schema
- Explicit builder methods still exist when you want readability:
  - `.inputSchema(...)`
  - `.configSchema(...)`
  - `.payloadSchema(...)`
  - `.dataSchema(...)`
- Tasks use `.resultSchema()` for output validation.
- Schema resolution prefers `parse(input)` when present; otherwise Runner falls back to pattern validation (`check(...)`).
- Builder schema slots accept plain Match patterns, compiled Match schemas, decorator-backed classes, or any schema object exposing `parse(...)`.
- For the strongest TypeScript inference in docs and user code, prefer `Match.compile(...)`, decorator-backed classes, or explicit builder generics such as `r.event<T>()`.
- List builders append by default. Pass `{ override: true }` to replace.
- `.meta({ ... })` is available across builders for docs and tooling.
- Builder order is enforced. After terminal methods like `.run()` or `.init()`, mutation surfaces are intentionally reduced.
- Prefer local names in definitions such as `task("createUser")`.
- Runner composes canonical ids from the owner subtree at runtime.
- Runtime and store internals always expose canonical ids.
- Reserved local names fail fast:
  - `tasks`
  - `resources`
  - `events`
  - `hooks`
  - `tags`
  - `errors`
  - `ctx`
- Ids cannot start or end with `.`, and cannot contain `..`.

Schema quick guide:

```ts
import { Match, r } from "@bluelibs/runner";

const userInput = Match.compile({
  email: Match.Email,
  age: Match.Optional(Match.Integer),
});

const appConfig = Match.compile({
  env: Match.OneOf("dev", "test", "prod"),
  featureFlags: Match.Optional(Match.MapOf(Boolean)),
});

const createUser = r
  .task("createUser")
  .inputSchema(userInput) // same as .schema(userInput)
  .run(async (input) => ({ id: "u1", ...input }))
  .resultSchema({ id: Match.NonEmptyString, email: Match.Email })
  .build();

const app = r
  .resource("app")
  .configSchema(appConfig) // same as .schema(appConfig)
  .register([createUser])
  .build();

const userCreated = r
  .event("userCreated")
  .payloadSchema(
    Match.compile({ id: Match.NonEmptyString, email: Match.Email }),
  )
  .build();

// Compiled Match schemas expose:
userInput.pattern; // original Match pattern
userInput.parse({ email: "ada@example.com" }); // validate + return typed value
userInput.test({ email: "ada@example.com" }); // boolean type guard
userInput.toJSONSchema(); // machine-readable contract for tooling
```

## Runtime and Lifecycle

- `run(app, options?)` wires dependencies, initializes resources, emits lifecycle events, and returns the runtime API.
- The returned runtime exposes `runOptions`, the normalized effective `run(...)` options for that container.
- Main runtime helpers:
  - `runTask`
  - `emitEvent`
  - `getResourceValue`
  - `getLazyResourceValue`
  - `getResourceConfig`
  - `getHealth`
  - `dispose`
- Use `run(app, { debug: "verbose" })` for structured debug output.
- Use `run(app, { logs: { printThreshold: null } })` to silence console output.
- `dryRun: true` validates the graph without starting resources.
- `lazy: true` defers startup-unused resources until on-demand access.
- `lifecycleMode: "parallel"` enables dependency-safe parallel startup/init and disposal waves (applies to `ready()` and `cooldown()` too).
- `runtime.pause()` is a synchronous, idempotent admission switch.
  It stops new runtime-origin task and event admissions immediately, while already-running work can finish.
- `runtime.state` is `"running" | "paused"`.
- `runtime.resume()` reopens admissions immediately.
- `runtime.recoverWhen({ everyMs, check })` registers paused-state recovery conditions; Runner auto-resumes only after all active conditions for the current pause episode pass.
- `executionContext: true | { createCorrelationId?, cycleDetection? }` enables correlation tracking and execution tree recording (Node-only; requires `AsyncLocalStorage`). See "Execution Context and Request Tracing" below.
- `system.ctx.executionContext.use()` returns the current branch snapshot: `{ correlationId, startedAt, depth, currentFrame, frames }`.

Lifecycle:

- Startup order:
  - wire dependencies
  - `init` resources
  - lock runtime mutation surfaces
  - run `ready()` in dependency order
  - emit `events.ready`
- Shutdown order:
  - enter `coolingDown`
  - run `cooldown()` in reverse dependency order
  - enter `disposing`
  - emit `events.disposing`
  - drain in-flight work
  - emit `events.drained`
  - run `dispose()` in reverse dependency order

## Resources

Resources model shared services and state.
They are Runner's main composition and ownership unit: a resource can register child definitions, expose a value, enforce boundaries, and define lifecycle behavior.

- Start most apps with `const runtime = await run(appResource)`.
- The runtime then gives you `runTask(...)`, `emitEvent(...)`, `getResourceValue(...)`, `getLazyResourceValue(...)`, `getResourceConfig(...)`, `getHealth(...)`, `pause()`, `resume()`, `recoverWhen(...)`, and `dispose()`.

- `init(config, deps, context)` creates the value.
- `ready(value, config, deps, context)` starts ingress after startup lock and runs after dependencies are all initialized.
- `cooldown(value, config, deps, context)` stops ingress quickly at shutdown start and runs during `coolingDown`, before `disposing` begins. Task runs and event emissions stay open during `coolingDown`. Once `disposing` begins, the cooling resource itself remains allowed as a resource-origin source during the shutdown drain window, and `cooldown()` may optionally return additional resource definitions whose resource-origin task/event admissions should remain allowed too.
- `dispose(value, config, deps, context)` performs final teardown after drain and runs in reverse dependency order.
- `health(value, config, deps, context)` is an optional async probe used by `resources.health.getHealth(...)` and `runtime.getHealth(...)`.
  Return `{ status: "healthy" | "degraded" | "unhealthy", message?, details? }`.
- Config-only resources can omit `.init()` — their resolved value is `undefined`; they are used purely for configuration access and registration.
- `r.resource(id, { gateway: true })` prevents the resource from adding its own namespace segment.
- Gateway resources cannot be passed directly to `run(...)`; wrap them in a non-gateway root resource first.
- If you register something, you are a non-leaf resource.
- Non-leaf resources cannot be forked.
- Gateway resources cannot be forked with `.fork()` because multiple gateway instances would compile the same child canonical ids.
- `.context(() => initialContext)` can hold mutable resource-local state used across lifecycle phases.

Use the lifecycle intentionally:

- `ready()` for starting HTTP listeners, consumers, schedulers, and similar ingress
- `cooldown()` for stopping new work immediately
- `dispose()` for final cleanup

Health reporting:

- Only resources that define `health()` participate.
- `resources.health` is the built-in health reporter resource from the exported `resources` namespace.
- Prefer `resources.health.getHealth()` inside resources; keep `runtime.getHealth()` for operator/runtime callers.
- Health checks are available only after `run(...)` resolves and before disposal starts.
- Calling `getHealth()` during disposal or after `dispose()` starts is invalid; treat health APIs as unavailable once shutdown begins.
- Startup-unused lazy resources stay asleep and are skipped; requested resources without `health()` are ignored.
- Result shape is `{ totals, report, find(...) }`, with counts for `healthy`, `degraded`, and `unhealthy`.
- `report` entries look like `{ id, initialized, status, message?, details? }`, where `id` is the canonical global runtime id.
- Use `report.find(resourceOrId).status` when you want one specific resource entry.
  It returns the entry or throws if that resource is not present in the report.
- If `health()` throws, Runner records that resource as `unhealthy` and places the normalized error on `details`.
- When health indicates temporary pressure or outage, prefer `runtime.pause()` over shutdown.
  It simply stops new runtime-origin and resource-origin task runs and event emissions while already-running work continues.
- `runtime.recoverWhen({ everyMs, check })` belongs on that paused path.
  Register it after `pause()` when you want Runner to poll a recovery condition and auto-resume once the current incident is cleared.

Do not use `cooldown()` as a general teardown phase for support resources like databases. Use `cooldown()` to stop accepting new external work; use `dispose()` for final teardown.

## Tasks

Tasks are your main business actions.

- For lifecycle-owned timers, depend on `resources.timers` inside a task or resource.
  `timers.setTimeout()` and `timers.setInterval()` are available during `init()`, stop accepting new timers once `cooldown()` starts, and clear pending timers during `dispose()`.
- Tasks are async functions with DI, middleware, validation, and typed output.
- Dependency maps are fail-fast validated. If `dependencies` is a function, it must resolve to an object map.
- Optional dependencies are explicit: `someResource.optional()`.
- `.throws([...])` declares error contracts for docs and tooling.
- Task `.run(input, deps, context)` receives three arguments:
  - `input`: the validated task input
  - `deps`: the resolved dependency map
  - `context`: auto-injected execution context (always the third arg — never part of `deps`)
    - `context.journal`: per-task typed state shared with middleware
    - `context.source`: `{ kind, id }` — canonical id of the running task

Example showing all three parameters:

```ts
const sendEmail = r
  .task<{ to: string; body: string }>("sendEmail")
  .dependencies({ logger: resources.logger })
  .run(async (input, { logger }, context) => {
    // context.journal stores execution-local state accessible by middleware too
    context.journal.set(auditKey, { startedAt: Date.now() });
    await logger.info(`Sending email to ${input.to}`);
    return { delivered: true };
  })
  .build();
```

### ExecutionJournal

`ExecutionJournal` is typed state scoped to a single task execution.

- Use it when middleware and tasks need to share execution-local state.
- `journal.set(key, value)` fails if the key already exists.
- Pass `{ override: true }` when replacement is intentional.
- Create custom keys with `journal.createKey<T>(id)`.
- Task context includes `journal` and `source`.

## Events and Hooks

Events decouple producers from listeners. Hooks subscribe with `.on(event)` or `.on(onAnyOf(...))`; passing arrays directly is invalid.

Key rules:

- `.order(priority)` controls execution order. Lower numbers run first.
- `event.stopPropagation()` prevents downstream hooks from running.
- `.on("*")` listens to all visible events except those tagged with `tags.excludeFromGlobalHooks`.
- `.parallel(true)` allows concurrent same-priority listeners.
- `.transactional(true)` makes listeners reversible; each executed hook must return an async undo closure.
- Transactional constraints are fail-fast:
  - `transactional + parallel` is invalid.
  - `transactional + tags.eventLane` is invalid.

Emitters accept controls via `await event(payload, options?)`:

- `failureMode`: `"fail-fast"` (default, aborts on first hook error) or `"aggregate"` (runs all hooks, collects errors).
- `throwOnError`: `true` (default). When `false` with `report: true`, lets calling code handle failures gracefully.
- `report: true`: returns `{ totalListeners, attemptedListeners, skippedListeners, succeededListeners, failedListeners, propagationStopped, errors }`. (Note: for transactional events, fail-fast rollback is enforced regardless of mode).
- If rollback handlers fail, Runner continues the remaining rollbacks and throws a transactional rollback failure that preserves the original trigger failure as the cause.

Transactional hook example:

```ts
const orderPlaced = r
  .event<{ orderId: string }>("orderPlaced")
  .transactional()
  .build();

const reserveInventory = r
  .hook("reserveInventory")
  .on(orderPlaced)
  .run(async (event) => {
    // Transactional: `run(async (event) => { /* do work */ return async () => { /* rollback */ } })`
    await inventory.reserve(event.data.orderId);
    return async () => await inventory.release(event.data.orderId);
  })
  .build();
```

## Middleware

Middleware wraps tasks or resources.

```ts
const audit = r.middleware
  .task("audit")
  .dependencies({ logger: resources.logger })
  .run(async ({ task, next }, { logger }) => {
    await logger.info(`-> ${task.definition.id}`);
    const result = await next(task.input);
    await logger.info(`<- ${task.definition.id}`);
    return result;
  })
  .build();
```

Key rules:

- Create task middleware with `r.middleware.task(id)`.
- Create resource middleware with `r.middleware.resource(id)`.
- Attach middleware with `.middleware([...])`.
- First listed middleware is the outermost wrapper.
- Runner validates the target:
  - task middleware can attach only to tasks or `subtree.tasks.middleware`
  - resource middleware can attach only to resources or `subtree.resources.middleware`
- Owner-scoped auto-application is available through `resource.subtree({ tasks/resources: { middleware: [...] } })`.
- Contract middleware can constrain task input and output types.
- Built-in middleware covers common reliability concerns such as retry, cache, timeout, fallback, circuit breaker, rate limit, debounce, and concurrency.
- `taskRunner.intercept(...)` can wrap task executions globally at runtime.
- When a runtime predicate must match one specific task/event/resource definition, prefer `isSameDefinition(candidate, definitionRef)` over comparing public ids directly.

Task vs resource middleware:

- Task middleware wraps task execution.
- Resource middleware wraps resource initialization and resource value resolution.
- Task middleware receives execution input shaped around `{ task, next, journal }`.
- Resource middleware receives execution input shaped around `{ resource, next }`.
- Task middleware is where you usually apply auth, retry, cache, rate limit, fallback, tracing, and request-scoped policies.
- Resource middleware is where you usually apply retry or timeout around expensive startup or resource creation.
- Canonical ids differ:
  - task middleware -> `app.middleware.task.name`
  - resource middleware -> `app.middleware.resource.name`

### Global Interception

`eventManager.intercept(fn)`, `middlewareManager.intercept("task"|"resource", fn)`, `taskRunner.intercept(fn, options?)` wraps **all** task executions globally — the outermost layer. Use for cross-cutting concerns. Must be called inside a resource's `init()`.

```ts
const installer = r
  .resource("installer")
  .dependencies({ taskRunner: resources.taskRunner })
  .init(async (_, { taskRunner }) => {
    taskRunner.intercept(async (next, input) => next(input), {
      when: (def) => isSameDefinition(def, myTask),
    });
  })
  .build();
```

### Built-in Resilience Middleware

Runner ships with these resilience-focused built-ins.

| Middleware     | Config                                    | Notes                                                         |
| -------------- | ----------------------------------------- | ------------------------------------------------------------- |
| cache          | `{ ttl, max, ttlAutopurge, keyBuilder }`  | requires `resources.cache`; Node exposes `redisCacheProvider` |
| concurrency    | `{ limit, key?, semaphore? }`             | limits executions; share concurrency logic via `semaphore`    |
| circuitBreaker | `{ failureThreshold, resetTimeout }`      | opens after failures, fails fast until recovery               |
| debounce       | `{ ms }`                                  | runs only after inactivity                                    |
| throttle       | `{ ms }`                                  | max once per `ms`                                             |
| fallback       | `{ fallback }`                            | static value, function, or task fallback                      |
| rateLimit      | `{ windowMs, max }`                       | fixed-window limit per instance                               |
| retry          | `{ retries, stopRetryIf, delayStrategy }` | transient failures with configurable logic                    |
| timeout        | `{ ttl }`                                 | aborts long-running executions via AbortController            |

Resource: `middleware.resource.retry`, `middleware.resource.timeout` (same semantics).
Non-resilience: `middleware.task.requireContext.with({ context })` — enforces async context.

```ts
// Patterns: Order matters (outermost first)
r.task("cached").middleware([middleware.task.cache.with({ ttl: 60_000 })]).run(...).build();
r.task("fallback-retry").middleware([middleware.task.fallback.with({fallback:"default"}), middleware.task.retry.with({retries:3})]).run(...).build();
r.task("ratelimit-concurrency").middleware([middleware.task.rateLimit.with({windowMs:60_000,max:10}), middleware.task.concurrency.with({limit:5})]).run(...).build();
```

**Order:** fallback (outermost) → timeout (inside retry if per-attempt budgets needed) → others.
**Use:** rate-limit for admission, concurrency for in-flight, circuit-breaker for fail-fast, cache for idempotent reads, debounce/throttle for bursty calls.

Built-in journal keys exist for middleware introspection:

- `middleware.task.cache.journalKeys.hit`
- `middleware.task.retry.journalKeys.attempt` / `.lastError`
- `middleware.task.circuitBreaker.journalKeys.state` / `.failures`
- `middleware.task.rateLimit.journalKeys.remaining` / `.resetTime` / `.limit`
- `middleware.task.fallback.journalKeys.active` / `.error`
- `middleware.task.timeout.journalKeys.abortController`

## Data Contracts

### Validation

```ts
import { check, Match } from "@bluelibs/runner";
```

- `check(value, pattern)` is the low-level runtime validator.
- `Match.compile(pattern)` creates reusable schemas with `.parse()`, `.test()`, and JSON-Schema export.
- Constructors act as matchers: `String`, `Number`, `Boolean`.
- Common `Match.*` helpers include `NonEmptyString`, `Email`, `Integer`, `UUID`, `URL`, `Optional()`, `OneOf()`, `ObjectIncluding()`, `MapOf()`, `ArrayOf()`, `Lazy()`, and `Where()`.
- Plain objects are strict by default, so `check(value, { name: String })` rejects unknown keys.
- `@Match.Schema({ base: BaseClass })` allows subclassing without TypeScript `extends`.
- Builder slots accept the same schema sources everywhere: task input/output, config, payload, tag config, and error data.

### Errors

- `r.error(...)` defines typed Runner errors.
- Helpers expose `new`, `create`, `throw`, and `is`.
- `.is(err, partialData?)` checks error lineage and an optional data subset.
- `.httpCode()` and `.remediation()` enrich errors for transport and operator feedback.
- `r.error.is(err)` checks whether a value is any Runner error.

### Serialization

- The built-in serializer round-trips common non-JSON shapes such as `Date` and `RegExp`.
- Register custom types through `resources.serializer`.
- Use `serializer.parse(payload, { schema })` when you want deserialization and validation in one step.
- `@Serializer.Field({ from, deserialize, serialize })` composes with `@Match.Field(...)` on `@Match.Schema()` classes for explicit DTOs.

## Testing

- In unit tests, build the smallest root resource that expresses the contract you care about.
- Run it with `await run(app)`.
- Assert through `runTask`, `emitEvent`, `getResourceValue`, or `getResourceConfig`.
- `r.override(base, fn)` is the standard way to swap behavior in tests while preserving ids.

## Composition Boundaries

Runner treats composition boundaries as first-class.

### Isolation

- `.isolate({ exports: [...] })` controls what a resource exposes outside its subtree.
- `.isolate((config) => ({ ... }))` makes exports and isolation rules depend on resource config.
- `exports: []` or `exports: "none"` makes a subtree private.
- `exports` array entries must be explicit Runner definition or resource references.
- `deny` and `only` control cross-boundary wiring by channel.
- `whitelist` adds narrow per-boundary grants for specific consumers without reopening ancestor restrictions.
- Use definition refs, `subtreeOf(resource)`, or `scope(target, channels?)`.
- Bare strings are invalid in `deny` and `only`.
- `whitelist.for` and `whitelist.targets` accept the same selector forms, so subtree grants such as `{ for: [subtreeOf(agentResource)], targets: [resources.health] }` are valid.
- Isolation rules are additive through ancestors.
- Unknown isolation targets fail fast at bootstrap.
- Isolation access violations are rejected during bootstrap wiring; they are not deferred to first runtime use.
- Runtime operator APIs are gated only by the root resource's `isolate.exports` surface.
- Dynamic isolate callbacks are resolved per configured resource instance during registration.
- `subtreeOf(resource)` matches by ownership subtree instead of id string matching.
- `scope(target, channels?)` applies channel-specific isolation rules such as `dependencies`, `listening`, `tagging`, or `middleware`.
- Legacy resource-level `exports` and fluent `.exports(...)` were removed in 6.x; use `isolate: { exports: [...] }` or `.isolate({ exports: [...] })`.

```ts
.isolate({
  deny: [subtreeOf(adminResource), scope([internalEvent], { listening: false })],
  whitelist: [{ for: [healthTask], targets: [resources.health] }],
})
```

### Subtrees

- `.subtree(policy)` and `.subtree((config) => policy)` can auto-attach middleware to nested tasks/resources.
- Subtrees can validate contained definitions.
- `subtree.validate` is generic for compiled subtree definitions and can be one function or an array.
- Typed validation is also available on `tasks`, `resources`, `hooks`, `events`, `tags`, `taskMiddleware`, and `resourceMiddleware`.
- Generic and typed validators both run when they match the same compiled definition.
- Validators receive only the compiled definition. Use `subtree((config) => ({ ... }))` when the policy depends on resource config.
- Use exported guards such as `isTask(...)` and `isResource(...)` inside `subtree.validate(...)` for cross-type checks.
- Validators are return-based:
  - return `SubtreeViolation[]` for normal policy failures
  - do not throw for expected validation failures

### Forks and Overrides

- `resource.fork(newId)` clones a leaf resource definition under a new id.
- Forks clone identity, not structure.
- If a resource declares `.register(...)`, it is non-leaf and `.fork()` is invalid.
- Use `.fork(...)` when you need another instance of a leaf resource.
- `.fork()` is not supported for gateway resources.
- `.fork()` returns a built resource. You do not call `.build()` again.
- Compose a distinct parent resource when you need a structural variant of a non-leaf resource.
- Durable support is registered via `resources.durable`, while concrete durable backends use normal forks such as `resources.memoryWorkflow.fork("app-durable")`.
- Use `r.override(base, fn)` when you need to replace behavior while preserving the original id.
- `.overrides([...])` applies override definitions during bootstrap.
- Override direction is downstream-only: declare overrides from the resource that owns the target subtree or from one of its ancestors. Child resources cannot replace parent-owned or sibling-owned definitions.
- Override targets must already exist in the graph.

Fork quick guide:

- `fork("new-id")`: same leaf resource behavior, new id
- non-leaf resource variant: compose a new parent resource and register the desired children explicitly
- durable workflow variant: register `resources.durable` and fork a backend such as `resources.memoryWorkflow.fork("app-durable")`

## Tags and Scheduling

Tags are Runner's typed discovery system. They attach metadata to definitions, can influence framework behavior, and can also be consumed as dependencies to discover matching definitions at runtime.

```ts
import { Match, r } from "@bluelibs/runner";

const httpRoute = r
  .tag("httpRoute")
  .for(["tasks"])
  .configSchema(
    Match.compile({
      method: Match.OneOf("GET", "POST"),
      path: Match.NonEmptyString,
    }),
  )
  .build();

const getHealth = r
  .task("getHealth")
  .tags([httpRoute.with({ method: "GET", path: "/health" })])
  .run(async () => ({ ok: true }))
  .build();
```

Key rules:

- Depending on a tag injects a typed accessor over matching definitions.
- `.for([...])` restricts which definition kinds can receive the tag.
- Tag configs are typed and validated like any other config surface, so `.configSchema(...)` accepts Match patterns, `Match.compile(...)`, class schemas, or any `parse(...)` schema.
- Contract tags shape task or resource typing without changing runtime behavior.
- Built-in tags such as `tags.system`, `tags.debug`, and `tags.excludeFromGlobalHooks` affect framework behavior.
- `tags.debug` supports preset levels or fine-grained per-component debug config.
- Tasks can opt into runtime health gating with `tags.failWhenUnhealthy.with([db, cache])`.
  It blocks only when one of those resources reports `unhealthy`; `degraded` still runs, bootstrap-time task calls are not gated, and sleeping lazy resources stay skipped.
- Tags are often the cleanest way to implement auto-discovery such as HTTP route registration, cron scheduling, cache warmers, or internal policies without manual registries.

Cron:

- `tags.cron` schedules tasks with cron expressions.
- Cron runs only when `resources.cron` is registered.
- One cron tag per task is supported.
- If `resources.cron` is not registered, cron tags remain metadata only.

## Execution Context and Request Tracing

> `ExecutionContext`: auto-managed bookkeeping (`correlationId`, `depth`, cycle detection). Different from `AsyncContext` (user-owned state).

```ts
// Enable globally
const runtime = await run(app, { executionContext: true }); // or { cycleDetection: false }

// Seed correlation at entry boundary
await system.ctx.executionContext.provide(
  { correlationId: req.headers["x-id"] },
  () => runtime.runTask(handleRequest, input),
);

// Use inside tasks/hooks/interceptors
const myTask = r
  .task("myTask")
  .run(async () => {
    const { correlationId, depth, frames } = system.ctx.executionContext.use();
  })
  .build();

// Record exact call tree during testing/tracing
const { result, recording } = await system.ctx.executionContext.record({}, () =>
  runtime.runTask(myTask, input),
);
```

## Async Context

Defines serializable request-local state scoped to an async execution tree (requires `AsyncLocalStorage`; Node-only in practice).

```ts
import { r } from "@bluelibs/runner";

const tenantCtx = r.asyncContext<string>("tenantId");

// Provide at the request boundary
await tenantCtx.provide("acme-corp", () =>
  runtime.runTask(handleRequest, input),
);

// Consume anywhere downstream in the same async tree
const myTask = r
  .task("myTask")
  .run(async () => {
    const tenantId = tenantCtx.use(); // "acme-corp"
  })
  .build();
```

Contexts can be injected as dependencies or enforced by middleware via `middleware.task.requireContext.with({ context: tenantCtx })`. Custom `serialize` / `parse` support propagation over RPC lanes.

## Queue

`resources.queue` provides named FIFO queues. Each queue id gets its own isolated instance.

`queue.run(id, task)` schedules work sequentially. Each queued task receives `(signal: AbortSignal) => Promise<void>`, and the signal fires during `dispose()` — always respect it to avoid hanging shutdown:

```ts
await queue.run("uploads", async (signal) => {
  if (signal.aborted) return;
  await processFile(file, signal);
});
```

## Remote Lanes (Node)

Event lanes are async fire-and-forget routing for events across Runner instances. RPC lanes are synchronous cross-runner task or event calls.

Supported modes: `network`, `transparent`, `local-simulated`. Async-context propagation over RPC lanes is allowlist-based.

Full detail: `readmes/REMOTE_LANES_AI.md`, `readmes/REMOTE_LANES.md`

## Observability and Project Structure

### Observability

- `resources.logger` is the built-in structured logger.
- Loggers support `trace`, `debug`, `info`, `warn`, `error`, and `critical`.
- `logger.with({ source, additionalContext })` creates contextual child loggers that share the same root listeners and buffering.
- `logger.onLog(async (log) => { ... })` lets you forward, redact, or collect logs without routing them through the event system.
- `run(app, { logs: { printThreshold, printStrategy, bufferLogs } })` controls printing and startup buffering.
- Prefer stable `source` ids and low-cardinality context fields such as `requestId`, `taskId`, or `tenantId`.

### Project Structure

- Prefer feature-driven folders.
- Prefer naming by Runner item type:
  - `*.task.ts`
  - `*.resource.ts`
  - `*.event.ts`
  - `*.hook.ts`
  - `*.middleware.ts`
  - `*.tag.ts`
  - `*.error.ts`

## When To Leave This File

Use the dedicated docs when you need:

- deeper isolation policy behavior
- override edge cases and precedence rules
- full observability guidance
- full Remote Lanes behavior
- transport-specific RPC HTTP details
- exhaustive cron options
- the full `Match` pattern catalog
- serializer customization detail
- platform-specific Node helpers
