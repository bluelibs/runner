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

Prefer the flat globals for built-ins, exported by runner:

- `resources.*`
- `events.*`
- `tags.*`
- `errors.*`
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
- Schema resolution prefers `parse(input)` when present; otherwise Runner compiles raw Match patterns once and reuses the compiled schema.
- Builder schema slots accept plain Match patterns, compiled Match schemas, decorator-backed classes, or any schema object exposing `parse(...)`.
- Raw Match patterns infer directly in schema slots, including fluent builders and `define*` APIs.
- Match-native helpers and built-in tokens also expose `.parse()`, `.test()`, and `.toJSONSchema()` directly.
- Prefer `Match.compile(...)` when you want to reuse the same schema value yourself, or when you want direct access to the original `.pattern` alongside `.parse()`, `.test()`, and `.toJSONSchema()` before handing it to Runner.
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
  - `asyncContexts`
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
  .inputSchema({ email: Match.Email, age: Match.Optional(Match.Integer) })
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
  .payloadSchema({ id: Match.NonEmptyString, email: Match.Email })
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
- Lifecycle-shaping run options:
  - `dryRun: true`: validate the graph without running `init()` / `ready()` or starting ingress.
  - `lazy: true`: keep startup-unused resources asleep until `getLazyResourceValue(...)` wakes them; their `ready()` runs when they initialize, and lazy wakeups are rejected once shutdown starts.
  - `lifecycleMode: "parallel"`: keep dependency ordering, but allow same-wave `init`, `ready`, `cooldown`, and `dispose` to run in parallel.
  - `shutdownHooks: true`: install `SIGINT` / `SIGTERM` graceful shutdown hooks; signals during bootstrap cancel startup and roll back initialized resources.
  - `dispose: { totalBudgetMs, drainingBudgetMs, cooldownWindowMs }`: control the bounded shutdown-wait budget, the drain wait, and the short post-`cooldown()` admissions window.
  - `errorBoundary: true`: install process-level unhandled error capture and route it through `onUnhandledError`.
  - `executionContext: true | { ... }`: enable correlation ids and inherited execution signals, with optional frame tracking and cycle detection for task/event execution.
  - `mode: "dev" | "prod" | "test"`: override environment-based mode detection. The effective resolved mode is always available at runtime as `runtime.mode`, and inside resources as `resources.mode`, even when you did not pass `mode` explicitly.
- `debug` and `logs` tune observability; they do not change lifecycle semantics.
- For the full option table, see the `run() and RunOptions` section in [FULL_GUIDE.md](./FULL_GUIDE.md).
- Use `run(app, { debug: "verbose" })` for structured debug output.
- Use `run(app, { logs: { printThreshold: null } })` to silence console output.
- `runtime.pause()` is a synchronous, idempotent admission switch.
  It stops new runtime-origin task and event admissions immediately, while already-running work can finish.
- `runtime.state` is `"running" | "paused"`.
- `runtime.resume()` reopens admissions immediately.
- `runtime.recoverWhen({ everyMs, check })` registers paused-state recovery conditions; Runner auto-resumes only after all active conditions for the current pause episode pass.

Runtime mode access:

```ts
const runtime = await run(app);

runtime.mode; // "dev" | "prod" | "test"
```

Inside resources, prefer the narrow DI value:

```ts
const app = r
  .resource("app")
  .dependencies({ mode: resources.mode })
  .init(async (_config, { mode }) => {
    if (mode === "test") {
      // install test-only behavior
    }

    return "ready";
  })
  .build();
```

Dynamic resource callbacks also receive the resolved mode:

```ts
const app = r
  .resource<{ enableDevTools: boolean }>("app")
  .register((config, mode) => [
    ...(config.enableDevTools && mode === "dev" ? [devToolsResource] : []),
  ])
  .build();
```

## Serverless / AWS Lambda

- Treat the Lambda handler as a thin ingress adapter: parse the API Gateway event, provide request async context, then call `runtime.runTask(...)`.
- Cache the `run(app, { shutdownHooks: false })` promise across warm invocations so cold-start bootstrap happens once per container.
- Prefer task `.inputSchema(...)` for business validation. Keep the handler focused on HTTP adaptation and error mapping.
- Require request-local business state with `r.asyncContext(...).require()` so missing context fails fast instead of turning into silent cross-request bugs.
- Use an explicit `disposeRunner()` helper only for tests, local scripts, or environments where you truly control process teardown.
- See `examples/aws-lambda-quickstart` for a lambdalith and per-route example.

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
  - if budget remains and `dispose.cooldownWindowMs` is greater than `0`, keep admissions open during that bounded window
  - enter `disposing`
  - emit `events.disposing`
  - drain in-flight work (`dispose.drainingBudgetMs`, capped by remaining `dispose.totalBudgetMs`)
  - emit `events.drained`
  - run `dispose()` in reverse dependency order

## Resources

Resources model shared services and state.
They are Runner's main composition and ownership unit: a resource can register child definitions, expose a value, enforce boundaries, and define lifecycle behavior.

- Start most apps with `const runtime = await run(appResource)`.
- The runtime then gives you `runTask(...)`, `emitEvent(...)`, `getResourceValue(...)`, `getLazyResourceValue(...)`, `getResourceConfig(...)`, `getHealth(...)`, `pause()`, `resume()`, `recoverWhen(...)`, and `dispose()`.

- `init(config, deps, context)` creates the value.
- `ready(value, config, deps, context)` starts ingress after startup lock and runs after dependencies are all initialized.
- `getLazyResourceValue(...)` is only valid before shutdown starts; once the runtime enters `coolingDown` or later, startup-unused resources stay asleep and wakeup attempts fail fast.
- `cooldown(value, config, deps, context)` stops ingress quickly at shutdown start and runs during `coolingDown`, before `disposing` begins. Runner fully awaits `cooldown()` before it narrows admissions, and the time spent in `cooldown()` still counts against the remaining `dispose.totalBudgetMs` budget for later bounded waits. Task runs and event emissions stay open during `coolingDown`, and if `dispose.cooldownWindowMs` is greater than `0` Runner keeps that broader admission policy open for the extra bounded window after cooldown completes. At the default `0`, Runner skips that wait. Once `disposing` begins, fresh admissions narrow to the cooling resource itself, any additional resource definitions returned from `cooldown()`, and in-flight continuations.
- `dispose(value, config, deps, context)` performs final teardown after drain and runs in reverse dependency order.
- `health(value, config, deps, context)` is an optional async probe used by `resources.health.getHealth(...)` and `runtime.getHealth(...)`.
  Return `{ status: "healthy" | "degraded" | "unhealthy", message?, details? }`.
- Config-only resources can omit `.init()` — their resolved value is `undefined`; they are used purely for configuration access and registration.
- User resources contribute their own ownership segment to canonical ids.
- The app resource passed to `run(...)` is a normal resource, so direct registrations compile as `app.tasks.x`, `app.events.x`, `app.middleware.task.x`, and so on.
- Child resources continue that chain, so nested registrations compile as `app.billing.tasks.x`.
- Only the internal synthetic framework root is transparent, and it does not appear in user-facing ids.
- `runtime-framework-root` is reserved for that internal framework root and cannot be used as a user resource id.
- If you register something, you are a non-leaf resource.
- Non-leaf resources cannot be forked.
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
    - `context.source`: `{ kind, id }` — canonical runtime source of the running task

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

| Middleware     | Config                                    | Notes                                                                    |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| cache          | `{ ttl, max, ttlAutopurge, keyBuilder }`  | backed by `resources.cache`; customize with `resources.cache.with(...)`  |
| concurrency    | `{ limit, key?, semaphore? }`             | limits executions; share concurrency logic via `semaphore`               |
| circuitBreaker | `{ failureThreshold, resetTimeout }`      | opens after failures, fails fast until recovery                          |
| debounce       | `{ ms, keyBuilder? }`                     | waits for inactivity, then runs once with the latest input for that key  |
| throttle       | `{ ms, keyBuilder? }`                     | runs immediately, then suppresses burst calls until the window ends      |
| fallback       | `{ fallback }`                            | static value, function, or task fallback                                 |
| rateLimit      | `{ windowMs, max, keyBuilder? }`          | fixed-window admission limit per key, eg "50 per second"                 |
| retry          | `{ retries, stopRetryIf, delayStrategy }` | transient failures with configurable logic                               |
| timeout        | `{ ttl }`                                 | rejects after the deadline and aborts cooperative work via `AbortSignal` |

Resource: `middleware.resource.retry`, `middleware.resource.timeout` (same semantics).
Non-resilience: `middleware.task.requireContext.with({ context })` — enforces async context.

```ts
// Patterns: Order matters (outermost first)
r.task("cached").middleware([middleware.task.cache.with({ ttl: 60_000 })]).run(...).build();
r.task("fallback-retry").middleware([middleware.task.fallback.with({fallback:"default"}), middleware.task.retry.with({retries:3})]).run(...).build();
r.task("ratelimit-concurrency").middleware([middleware.task.rateLimit.with({windowMs:60_000,max:10}), middleware.task.concurrency.with({limit:5})]).run(...).build();
r.task("ratelimit-ip").middleware([middleware.task.rateLimit.with({windowMs:1_000,max:50,keyBuilder:() => RequestContext.use().ip})]).run(...).build();
```

When using task caching, register `resources.cache` in a parent resource. It auto-registers `middleware.task.cache` so cached tasks can attach `middleware.task.cache.with(...)`.

**Order:** fallback (outermost) → timeout (inside retry if per-attempt budgets needed) → others.
**Use:** rate-limit for quotas like "50/s", concurrency for in-flight, circuit-breaker for fail-fast, cache for idempotent reads, debounce/throttle for burst shaping.
**Partitioning:** `rateLimit`, `debounce`, and `throttle` default to `taskId`; pass `keyBuilder(taskId, input)` to partition by async-context values, user ids, tenants, or similar keys. When `tenantScope` is active, Runner prefixes the final internal key as `<tenantId>:<baseKey>`.

Built-in journal keys exist for middleware introspection:

- `middleware.task.cache.journalKeys.hit`
- `middleware.task.retry.journalKeys.attempt` / `.lastError`
- `middleware.task.circuitBreaker.journalKeys.state` / `.failures`
- `middleware.task.rateLimit.journalKeys.remaining` / `.resetTime` / `.limit`
- `middleware.task.fallback.journalKeys.active` / `.error`
- `middleware.task.timeout.journalKeys.abortController`

Task calls and event emissions now accept `signal?: AbortSignal`.

- top-level callers can pass `runTask(task, input, { signal })` or `emit(payload, { signal })`
- when cancellation is active, tasks see `context.signal` and hooks see `event.signal`
- injected event emitters accept `emit(payload, { signal })`, and low-level event-manager APIs accept a merged `IEventEmissionCallOptions` object such as `{ source, signal, report }`
- RPC lane calls forward the active task or event signal automatically
- timeout middleware reuses the same cooperative cancellation path instead of owning a separate public abort API
- `middleware.task.timeout.journalKeys.abortController` remains available for middleware coordination and compatibility
- if no cancellation source exists, `context.signal` and `event.signal` stay `undefined` rather than using a shared fake signal

Execution-context-driven inheritance and ambient propagation live in the "Execution Context" section below.

## Data Contracts

### Validation

```ts
import { check, Match } from "@bluelibs/runner";
```

- `check(value, pattern)` is the low-level runtime validator.
- `Match.compile(pattern)` creates reusable schemas with `.parse()`, `.test()`, and JSON-Schema export.
- Match-native helpers and built-in tokens expose the same `.parse()`, `.test()`, and `.toJSONSchema()` surface directly.
- `type Output = Match.infer<typeof schema>` is the ergonomic type-level inference alias for Match patterns and schema-like values.
- `check(value, pattern)` validates and returns the same value reference on success; hydration happens on `parse(...)` paths, not on `check(...)`.
- The supported way to create reusable custom patterns is to compose Match-native helpers into named constants, for example `const AppMatch = { Slug: Match.WithMessage(Match.RegExp(/^[a-z0-9-]+$/), "Slug must be kebab-case.") } as const;`.
- Those reusable custom patterns work anywhere Match works: `check(value, AppMatch.Slug)`, `AppMatch.Slug.test(value)`, `Match.compile({ slug: AppMatch.Slug })`, and `@Match.Field(AppMatch.Slug)`.
- `CheckSchemaLike<T>` is the minimal custom top-level schema contract: implement `parse(input): T`, and optionally `toJSONSchema()` when you need machine-readable export for that schema.
- In a custom `CheckSchemaLike`, prefer `throw errors.matchError.new({ path: "$", failures: [...] })` for validation failures instead of `throw new Error(...)`.
- `CheckSchemaLike` is for top-level schema slots and `check(value, schema)`. It is not a public nested Match-pattern extension point, and manually thrown `path: "$"` values are not rebased into enclosing raw Match/class-schema paths.
- Class-backed schemas hydrate on `.parse()`: `Match.fromSchema(UserDto).parse(...)` returns a `UserDto` instance, and any raw Match pattern that contains class-schema nodes hydrates those nested nodes during parse.
- Hydration uses prototype assignment and does not call class constructors during parse.
- Compiled schemas do not expose `.extend()`; for object-shaped schemas, compose `compiled.pattern` into a new pattern and call `Match.compile(...)` again.
- Constructors act as matchers: `String`, `Number`, `Boolean`.
- Common `Match.*` helpers include `NonEmptyString`, `Email`, `Integer`, `UUID`, `URL`, `Range({ min?, max?, inclusive?, integer? })`, `Optional()`, `OneOf()`, `ObjectIncluding()`, `MapOf()`, `ArrayOf()`, `Lazy()`, `Where((value, parent?) => boolean, messageOrFormatter?)`, and `WithMessage(pattern, messageOrFormatter)`.
- Plain objects are strict by default, so `check(value, { name: String })` rejects unknown keys.
- Prefer a plain object for the normal strict case, `Match.ObjectStrict(...)` when you want that strictness to be explicit, and `Match.ObjectIncluding(...)` when extra keys are allowed.
- `@Match.Schema({ base: BaseClass })` allows subclassing without TypeScript `extends`.
- `@Match.Schema({ exact, schemaId, errorPolicy })` controls class strictness, schema identity, and the default validation aggregation policy.
- Default decorator exports target standard ES decorators. For legacy `experimentalDecorators` projects, import `Match` and `Serializer` from `@bluelibs/runner/decorators/legacy`.
- Runner decorators do not require `emitDecoratorMetadata` or `reflect-metadata`.
- The default `@bluelibs/runner` package initializes `Symbol.metadata` when it is missing, so ES decorators work without a manual polyfill on runtimes that do not expose it yet.
- Existing/native `Symbol.metadata` implementations are preserved.
- Use `Match.fromSchema(() => User)` for self-referencing or forward class-schema links.
- Use `Match.Lazy(() => pattern)` for recursive plain Match patterns; use `Match.fromSchema(() => User)` when the recursive thing is a decorated class schema.
- Use `Match.Where(...)` for runtime-only custom predicates and type guards, and prefer `Match.Where(..., messageOrFormatter)` when the main need is predicate-specific message sugar. Prefer `Match.RegExp(...)` / built-ins / object patterns when JSON Schema export needs to stay precise.
- `Match.Range({ min?, max?, inclusive?, integer? })` matches finite numbers within the configured bounds; `inclusive` defaults to `true`, `inclusive: false` makes both bounds exclusive, and `integer: true` restricts the range to integers.
- Example: `Match.Range({ min: 5, max: 10, integer: true })` validates integers between 5 and 10 without needing `Match.Where(...)`.
- Validation failures throw the built-in `errors.matchError` Runner error.
- The thrown error data exposes `.path` as the first recorded leaf-failure path, and `.failures` keeps the raw nested failures even when the top-level message comes from an outer schema/subtree wrapper.
- `Match.Where((value, parent?) => boolean, messageOrFormatter?)` receives the immediate parent when matching compound values.
- `Match.WithMessage(pattern, messageOrFormatter)` overrides the thrown match-error message.
- `Match.Where(..., messageOrFormatter)` is ergonomic sugar for `Match.WithMessage(Match.Where(...), messageOrFormatter)` and follows the same runtime semantics.
- `messageOrFormatter` accepts a string, `{ message, code?, params? }`, or a callback `(ctx) => string | { message, code?, params? }`.
- When using the callback form, `ctx` is `{ value, error, path, pattern, parent? }`.
- When `{ code, params }` is provided, Runner copies that metadata onto the owned `failures[]` entries while keeping each leaf failure's raw `message` intact.
- In formatter callbacks, `error` is rebuilt from the wrapped pattern's nested raw failures. It exposes the nested `path` and flat `failures`, but it does not preserve lower-level custom `Match.WithMessage(...)` headlines.
- Final match-error `failures` is always a flat array of leaf failures such as `$.address.city`; Runner does not add synthetic parent failures such as `$.address`.
- Use `check(value, pattern, { errorPolicy: "all" })` or `Match.WithErrorPolicy(pattern, "all")` when you want one aggregate match validation error containing every collected failure.
- Decorated class schemas can carry the same default via `@Match.Schema({ errorPolicy: "all" })`.
- Without `Match.WithMessage`, aggregate mode uses a summary headline for the collected failures. The exact formatting is not part of the public contract.
- In aggregate mode, leaf wrappers do not replace that summary, while subtree wrappers such as plain objects, arrays, maps, `Match.Lazy(...)`, and `Match.fromSchema(...)` can replace the top-level headline if they own the first collected failure.
- Decorator-backed class schemas follow the same rules as plain Match patterns: a field-level `Match.WithMessage(...)` changes the headline only for that failure, while a wrapper around `Match.fromSchema(ChildSchema)` can overtake the final headline for the whole child subtree.
- Builder slots accept the same schema sources everywhere: task input/output, config, payload, tag config, and error data.
- Runner schema slots consume schema parse results, so `.inputSchema(UserDto)` / `.configSchema(UserDto)` / `.payloadSchema(UserDto)` hand you hydrated `UserDto` instances by default.

### Errors

Typed errors are declared once and are usually registered + injected via DI, but the built helper also works locally outside `run(...)`.

```ts
const userNotFound = r
  .error<{ userId: string }>("userNotFound")
  // optional:
  .httpCode(404)
  .format((d) => `User '${d.userId}' not found`)
  .remediation((d) => `Verify user '${d.userId}' exists first.`)
  .build();

// in a task: .dependencies({ userNotFound }).throws([userNotFound])
userNotFound.throw({ userId: "u1" }); // never — throws IRunnerError
userNotFound.new({ userId: "u1" }); // constructs without throwing
userNotFound.is(err); // type guard
userNotFound.is(err, { severity: "high" }); // lineage + shallow data match
r.error.is(err); // any Runner error check
```

Thrown `IRunnerError` has: `.id`, `.data`, `.message` (from `.format()`, defaults to `JSON.stringify`), `.httpCode`, `.remediation`.
`.dataSchema(...)` validates data at throw-time. `.throws([...])` on task/resource/hook/middleware accepts Runner error helpers only and remains declarative metadata only.

- `.new()` / `.throw()` / `.is()` work directly on the helper even if it is used outside the Runner graph.
- Register the error when you want DI, store/discovery visibility, or app definitions to depend on it.
- `errors.genericError` is the built-in fallback for ad-hoc message-only errors; prefer domain-specific helpers when the contract is stable.

### Serialization

- The built-in serializer round-trips common non-JSON shapes such as `Date` and `RegExp`.
- Register custom types through `resources.serializer`.
- Use `serializer.parse(payload, { schema })` when you want deserialization and validation in one step.
- `@Serializer.Field({ from, deserialize, serialize })` composes with `@Match.Field(...)` on `@Match.Schema()` classes for explicit DTOs.
- For legacy decorator mode, import `Serializer` from `@bluelibs/runner/decorators/legacy`.

## Testing

- In unit tests, build the smallest root resource that expresses the contract you care about.
- Run it with `await run(app)`.
- Assert through `runTask`, `emitEvent`, `getResourceValue`, or `getResourceConfig`.
- `r.override(base, fn)` is the standard way to swap behavior in tests while preserving ids.
- Duplicate override targets are allowed only in resolved `test` mode; the outermost declaring resource wins, and same-resource duplicates use the last declaration.

## Composition Boundaries

Runner treats composition boundaries as first-class.

### Isolation

- Think of `.isolate(...)` as two controls on one boundary:
  - `exports`: what this subtree exposes outward
  - `deny` / `only` / `whitelist`: what consumers in this subtree may wire to across boundaries
- `exports: []` or `exports: "none"` makes the subtree private. Export entries must be explicit Runner definition or resource references.
- Runtime operator APIs such as `runTask`, `emitEvent`, and `getResourceValue` are gated only by the root resource's `isolate.exports` surface.
- `.isolate((config) => ({ ... }))` resolves once per configured resource instance.

Selector model:

- direct ref: one concrete definition/resource/tag
- `subtreeOf(resource, { types? })`: everything owned by that resource subtree
- `scope(target, channels?)`: apply the rule only to selected channels: `dependencies`, `listening`, `tagging`, `middleware`
- string selectors are valid only inside `scope(...)`
  - `scope("*")`: everything
  - `scope("system.*")`: all registered canonical ids matching that segment wildcard
  - `scope("app.resources.*")`: one dotted segment per `*`
- `subtreeOf(resource)` is ownership-based, not string-prefix-based

Rule model:

- `deny`: block matching cross-boundary targets
- `only`: allow only matching cross-boundary targets
- `whitelist`: per-boundary consumer -> target carve-out; it relaxes this boundary's `deny` / `only`, but does not override ancestor restrictions or make private exports public
- `whitelist.for` and `whitelist.targets` accept the same selector forms as `deny` and `only`
- unknown targets or selectors that resolve to nothing fail fast at bootstrap
- violations fail during bootstrap wiring, not first runtime use
- legacy resource-level `exports` and fluent `.exports(...)` were removed in 6.x; use `isolate: { exports: [...] }` or `.isolate({ exports: [...] })`

```ts
.isolate({
  deny: [subtreeOf(adminResource), scope([internalEvent], { listening: false })],
  whitelist: [{ for: [healthTask], targets: [resources.health] }],
})
```

Examples:

- Hide everything except one task from the outside:

```ts
.isolate({
  exports: [createInvoice],
})
```

- Block all `system.*` dependencies for this subtree except `runnerDev`:

```ts
.isolate({
  deny: [scope("system.*", { dependencies: true })],
  whitelist: [
    {
      for: [scope(subtreeOf(runnerDev), { dependencies: true })],
      targets: [scope("system.*", { dependencies: true })],
    },
  ],
})
```

- Allow only tasks owned by another subtree:

```ts
.isolate({
  only: [subtreeOf(agentResource, { types: ["task"] })],
})
```

### Subtrees

- `.subtree(policy)`, `.subtree([policyA, policyB])`, and `.subtree((config) => policy | policy[])` can auto-attach middleware to nested tasks/resources.
- If subtree middleware and local middleware resolve to the same middleware id on one target, Runner fails fast.
- Subtrees can validate contained definitions.
- `subtree.validate` is generic for compiled subtree definitions and can be one function or an array.
- Typed validation is also available on `tasks`, `resources`, `hooks`, `events`, `tags`, `taskMiddleware`, and `resourceMiddleware`.
- Generic and typed validators both run when they match the same compiled definition.
- Validators receive only the compiled definition. Use `subtree((config) => ({ ... }))` or `subtree((config) => [{ ... }, { ... }])` when the policy depends on resource config.
- Use exported guards such as `isTask(...)` and `isResource(...)` inside `subtree.validate(...)` for cross-type checks.
- Validators are return-based:
  - return `SubtreeViolation[]` for normal policy failures
  - do not throw for expected validation failures

### Forks and Overrides

- `resource.fork(newId)` clones a leaf resource definition under a new id.
- Forks clone identity, not structure.
- If a resource declares `.register(...)`, it is non-leaf and `.fork()` is invalid.
- Use `.fork(...)` when you need another instance of a leaf resource.
- `.fork()` returns a built resource. You do not call `.build()` again.
- Compose a distinct parent resource when you need a structural variant of a non-leaf resource.
- Durable support is registered via `resources.durable`, while concrete durable backends use normal forks such as `resources.memoryWorkflow.fork("app-durable")`.
- Use `r.override(base, fn)` when you need to replace behavior while preserving the original id.
- For resources only, `r.override(resource, { context, init, ready, cooldown, dispose })` is also supported.
- Resource object-form overrides inherit unspecified lifecycle hooks from the base resource and may add lifecycle stages the base resource did not define.
- Overriding resource `context` changes the private lifecycle-state contract shared across `init()` / `ready()` / `cooldown()` / `dispose()`.
- `.overrides([...])` applies override definitions during bootstrap.
- Override direction is downstream-only: declare overrides from the resource that owns the target subtree or from one of its ancestors. Child resources cannot replace parent-owned or sibling-owned definitions.
- Duplicate override targets fail fast outside `test` mode. In `test`, the outermost declaring resource wins; same-resource duplicates use the last declaration.
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
- Attach it on the task with `tags.cron.with({ expression: "* * * * *" })`; for example: `.tags([tags.cron.with({ expression: "0 9 * * *", immediate: true, ... })])`.
- Cron runs only when `resources.cron` is registered.
- One cron tag per task is supported.
- If `resources.cron` is not registered, cron tags remain metadata only.

## Execution Context

> `ExecutionContext`: auto-managed runtime bookkeeping for `correlationId`, inherited execution `signal`, and optional frame tracing. Different from `AsyncContext`, which is for user-owned business state.

```ts
// Full tracing mode.
const runtime = await run(app, { executionContext: true });

// Lightweight signal/correlation mode.
const fastRuntime = await run(app, {
  executionContext: { frames: "off", cycleDetection: false },
});

await runtime.runTask(handleRequest, input);
await runtime.emitEvent(userSeen, payload);

// Use inside tasks/hooks/interceptors
const myTask = r
  .task("myTask")
  .run(async () => {
    const execution = asyncContexts.execution.use();
    const { correlationId, signal } = execution;

    if (execution.framesMode === "full") {
      execution.currentFrame.kind;
      execution.frames;
    }
  })
  .build();

// Optional: seed your own execution metadata at an external boundary
await asyncContexts.execution.provide(
  { correlationId: req.headers["x-id"], signal: controller.signal },
  () => runtime.runTask(handleRequest, input),
);

// Optional: capture the exact execution tree during testing/tracing
const { result, recording } = await asyncContexts.execution.record(() =>
  runtime.runTask(myTask, input),
);
```

Enabling `executionContext` already creates execution context for top-level runtime task runs and event emissions. You do not need `provide()` just to enable propagation.

Use `executionContext: { frames: "off", cycleDetection: false }` when you mainly want cheap signal inheritance and correlation ids without full frame-stack bookkeeping. Use `executionContext: true` when you also want frame tracing and runtime cycle detection.

Execution signal model:

- pass a signal explicitly at the boundary with `runTask(..., { signal })` or `emit(..., { signal })`
- once execution context is enabled, nested dependency calls can inherit that ambient execution signal automatically
- the first signal attached to the execution tree becomes the ambient execution signal
- explicit nested signals stay local to that child call and do not rewrite the ambient execution signal for deeper propagation

Use `record()` when you want the execution tree back for assertions, tracing, or debugging. It temporarily promotes lightweight execution context to full frame tracking for the recorded callback.

`provide()` and `record()` do not create cancellation on their own. They only seed an existing signal into the execution tree when one already exists at the boundary.

`asyncContexts.execution` is not the same kind of surface as `r.asyncContext(...)`.
Use it to inspect or seed Runner's execution metadata, not to model arbitrary request-local business state.

Cycle protection comes in layers:

- declared `.dependencies(...)` cycles fail during bootstrap graph validation (it is middleware-aware too)
- declared hook-driven event bounce graphs fail during bootstrap event-emission validation
- dynamic runtime loops such as `task -> event -> hook -> task` need full execution-context frame tracking with `executionContext.cycleDetection` enabled to be stopped at execution time

`executionContext` is Node-only in practice because it requires `AsyncLocalStorage`.

## Async Context

Defines serializable request-local application state scoped to an async execution tree (requires `AsyncLocalStorage`; Node-only in practice).
This is the contract surface for business state such as tenant, auth, locale, or request metadata.
Do not use `asyncContexts.execution` as the mental model here; that surface is for runtime tracing and happens to be implemented on top of the same async-local mechanism.

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

## Multi-Tenant Systems

Runner's official same-runtime multi-tenant pattern uses `asyncContexts.tenant` (from runner package). Destructure it for brevity: `const { tenant } = asyncContexts`.

- `tenant.use()` returns `{ tenantId: string }` and throws when tenant context is required but missing.
- `tenant.tryUse()` returns `{ tenantId: string } | undefined`, and `tenant.has()` is a safe boolean check for shared or frontend-compatible code.
- `TenantContextValue` extends `ITenant`. Augment `TenantContextValue` when your app needs extra tenant metadata typed across `tenant.provide()`, `tenant.use()`, and `tenant.tryUse()`.
- Provide tenant identity at ingress with `tenant.provide({ tenantId }, fn)`.
- `tenant` is the built-in application async context contract. Unlike `asyncContexts.execution`, it exists to carry your business state.
- Tenant-sensitive middleware such as `cache`, `rateLimit`, `debounce`, `throttle`, and `concurrency` default to `tenantScope: "auto"`, which prefixes internal keys with `tenantId` when tenant context exists and otherwise falls back to the shared non-tenant keyspace.
- `tenantScope` modes:
  - `"auto"`: tenant-partition when tenant context exists; otherwise fall back to the normal non-tenant key
  - `"required"`: require tenant context and fail fast when it is missing
  - `"off"`: disable tenant partitioning entirely and use the shared non-tenant keyspace even if tenant context exists
- Middleware config types document these values directly on the `tenantScope` property for IDE hover help.
- Omit `tenantScope` for the default `"auto"` behavior, or set it explicitly when that helps readability.
- Use `"off"` only for intentional cross-tenant sharing such as a truly global cache, limit bucket, or semaphore namespace.
- Use `tenant.require()` when a task must never run outside tenant context.
- Async context propagation is Node-only in practice. On platforms without `AsyncLocalStorage`, `provide()` still runs the callback but does not propagate tenant state, so safe accessors matter in multi-platform code.

## Queue

`resources.queue` provides named FIFO queues. Each queue id gets its own isolated instance.

`queue.run(id, task)` schedules work sequentially. Each queued task receives `(signal: AbortSignal) => Promise<void>`.

- `queue.dispose()` drains already-queued work without aborting the active task.
- `queue.dispose({ cancel: true })` is teardown mode: it aborts the active task cooperatively and rejects queued-but-not-started work.
- `resources.queue` uses `queue.dispose({ cancel: true })` during runtime teardown and awaits every queue before the resource is considered disposed.

Always respect the signal in tasks that may be cancelled:

```ts
await queue.run("uploads", async (signal) => {
  if (signal.aborted) return;
  await processFile(file, signal);
});
```

## Remote Lanes (Node)

Event lanes are async fire-and-forget routing for events across Runner instances. RPC lanes are synchronous cross-runner task or event calls.

Supported modes: `network`, `transparent`, `local-simulated`. Async-context propagation over RPC lanes and event lanes is lane-allowlisted by default.

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
