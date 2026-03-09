# BlueLibs Runner: AI Field Guide

This is the minimal mental model for Runner. It is not the full manual.

Use this file to understand how Runner is composed, what the core contracts are, and where to look next. If you need option-by-option coverage, edge-case matrices, or transport-specific detail, use the dedicated docs.

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

## Core Builder Rules

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

## Resources

Resources model shared services and state.

- `init(config, deps, context)` creates the value.
- `ready(value, config, deps, context)` starts ingress after startup lock.
- `cooldown(value, config, deps, context)` stops ingress quickly at shutdown start.
- `dispose(value, config, deps, context)` performs final teardown after drain.
- Config-only resources can omit `.init()`.
- `r.resource(id, { gateway: true })` prevents the resource from adding its own namespace segment.
- If you register something, you are a non-leaf resource.
- Non-leaf resources cannot be forked.
- Gateway resources cannot be forked with `.fork()` because multiple gateway instances would compile the same child canonical ids.
- `.context(() => initialContext)` can hold mutable resource-local state used across lifecycle phases.

Use the lifecycle intentionally:

- `ready()` for starting HTTP listeners, consumers, schedulers, and similar ingress
- `cooldown()` for stopping new work immediately
- `dispose()` for final cleanup

Do not use `cooldown()` as a general teardown phase for support resources like databases.

## Tasks

Tasks are your main business actions.

- Tasks are async functions with DI, middleware, validation, and typed output.
- Dependency maps are fail-fast validated. If `dependencies` is a function, it must resolve to an object map.
- Optional dependencies are explicit: `someResource.optional()`.
- `.throws([...])` declares error contracts for docs and tooling.
- Task `run(..., deps, context)` receives auto-injected execution context:
  - `journal`: per-task typed state
  - `source`: `{ kind, id }`

Example:

```ts
const sendEmail = r
  .task<{ to: string; body: string }>("sendEmail")
  .dependencies({ logger: resources.logger })
  .run(async (input, { logger }) => {
    // Logger comes with the correct source prepare.
    await logger.info(`Sending email to ${input.to}`);
    return { delivered: true };
  })
  .build();
```

## Events and Hooks

Events decouple producers from listeners. Hooks subscribe to events.

```ts
import { onAnyOf, r } from "@bluelibs/runner";

const userRegistered = r.event<{ userId: string }>("userRegistered").build();

const userDeleted = r.event<{ userId: string }>("userDeleted").build();

const auditUserChanges = r
  .hook("auditUserChanges")
  .on(onAnyOf(userRegistered, userDeleted))
  .run(async (event) => {
    console.log(event.definition.id, event.data.userId);
  })
  .build();
```

Key rules:

- Hooks listen with `.on(event)` or `.on(onAnyOf(...))`.
- `.order(priority)` controls execution order. Lower numbers run first.
- `event.stopPropagation()` prevents downstream hooks from running.
- `.on("*")` listens to all visible events except those tagged with `tags.excludeFromGlobalHooks`.
- Use `.parallel(true)` on the event definition when same-priority listeners may run concurrently.
- Use `.transactional(true)` on the event definition when listeners must be reversible.
- In transactional mode, every executed hook must return an async undo closure:
  - `return async () => { ...rollback... }`
- Transactional behavior is event-level metadata, not hook-level metadata.
- If one hook fails, previously completed hooks are rolled back in reverse completion order.
- Rollback continues even if one undo fails; Runner throws an aggregated rollback error.
- `run(app)` does not change for transactional events. What changes is the hook contract.
- Transactional constraints are fail-fast:
  - `transactional + parallel` is invalid
  - `transactional + tags.eventLane` is invalid
- Emitters support:
  - `failureMode: "fail-fast" | "aggregate"`
  - `throwOnError`
  - `report`

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
    await inventory.reserve(event.data.orderId);

    return async () => {
      await inventory.release(event.data.orderId);
    };
  })
  .build();
```

## Middleware and ExecutionJournal

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

### Built-in Resilience Middleware

Runner ships with these resilience-focused built-ins.

Task middleware:

- `middleware.task.cache.with({ ttl, max, ttlAutopurge, keyBuilder })`
  - caches task results by task id + input
  - requires `resources.cache` to be registered
- `middleware.task.concurrency.with({ limit, key?, semaphore? })`
  - limits concurrent executions
  - use `key` to share a semaphore across middleware instances
  - use `semaphore` when you want explicit coordination
- `middleware.task.circuitBreaker.with({ failureThreshold, resetTimeout })`
  - opens after repeated failures and fails fast until recovery window
- `middleware.task.debounce.with({ ms })`
  - runs only after inactivity for `ms`
- `middleware.task.throttle.with({ ms })`
  - runs at most once per `ms`
- `middleware.task.fallback.with({ fallback })`
  - uses a static value, function, or another task when the primary fails
- `middleware.task.rateLimit.with({ windowMs, max })`
  - fixed-window execution limit per middleware instance
- `middleware.task.retry.with({ retries, stopRetryIf, delayStrategy })`
  - retries transient failures with configurable stop and delay logic
- `middleware.task.timeout.with({ ttl })`
  - aborts long-running executions with `AbortController`

Resource middleware:

- `middleware.resource.retry.with({ retries, stopRetryIf, delayStrategy })`
  - retries resource initialization
- `middleware.resource.timeout.with({ ttl })`
  - prevents resource initialization from hanging indefinitely

Non-resilience but commonly paired:

- `middleware.task.requireContext.with({ context })`
  - enforces that an async context exists before task execution

Quick usage examples:

```ts
const cachedTask = r
  .task("cachedTask")
  .middleware([
    middleware.task.cache.with({
      ttl: 60_000,
      keyBuilder: (taskId, input) => `${taskId}:${JSON.stringify(input)}`,
    }),
  ])
  .run(async (input) => expensiveCall(input))
  .build();

const resilientTask = r
  .task("resilientTask")
  .middleware([
    middleware.task.fallback.with({ fallback: "default" }),
    middleware.task.retry.with({ retries: 3 }),
    middleware.task.timeout.with({ ttl: 5_000 }),
    middleware.task.circuitBreaker.with({
      failureThreshold: 5,
      resetTimeout: 30_000,
    }),
  ])
  .run(async () => unreliableCall())
  .build();

const protectedTask = r
  .task("protectedTask")
  .middleware([
    middleware.task.rateLimit.with({ windowMs: 60_000, max: 10 }),
    middleware.task.concurrency.with({ limit: 5, key: "shared-api-budget" }),
  ])
  .run(async () => externalCall())
  .build();

const startupResource = r
  .resource("startupResource")
  .middleware([
    middleware.resource.retry.with({ retries: 2 }),
    middleware.resource.timeout.with({ ttl: 15_000 }),
  ])
  .init(async () => connectBroker())
  .build();
```

Composition guidance:

- Put fallback outermost when it should catch the final failure after retry, timeout, or circuit-breaker logic.
- Put timeout inside retry when each retry attempt should get its own budget.
- Use rate limiting to control admission count over time.
- Use concurrency to control simultaneous work in flight.
- Use circuit breaker when repeated failures should turn into fail-fast behavior.
- Use cache only for idempotent or acceptably stale reads.
- Use debounce and throttle for bursty event-like task calls, not for general request-response logic.

Built-in journal keys exist for several task middleware:

- `middleware.task.cache.journalKeys.hit`
- `middleware.task.retry.journalKeys.attempt`
- `middleware.task.retry.journalKeys.lastError`
- `middleware.task.circuitBreaker.journalKeys.state`
- `middleware.task.circuitBreaker.journalKeys.failures`
- `middleware.task.rateLimit.journalKeys.remaining`
- `middleware.task.rateLimit.journalKeys.resetTime`
- `middleware.task.rateLimit.journalKeys.limit`
- `middleware.task.fallback.journalKeys.active`
- `middleware.task.fallback.journalKeys.error`
- `middleware.task.timeout.journalKeys.abortController`

### ExecutionJournal

`ExecutionJournal` is typed state scoped to a single task execution.

- Use it when middleware and tasks need to share execution-local state.
- `journal.set(key, value)` fails if the key already exists.
- Pass `{ override: true }` when replacement is intentional.
- Create custom keys with `journal.createKey<T>(id)`.
- Task context includes `journal` and `source`.

## Isolation, Subtrees, Forks, and Overrides

Runner treats composition boundaries as first-class.

- `.isolate({ exports: [...] })` controls what a resource exposes outside its subtree.
- `exports: []` or `exports: "none"` makes a subtree private.
- `exports` array entries must be explicit Runner definition or resource references.
- `deny` and `only` control cross-boundary wiring by channel.
- Use definition refs, `subtreeOf(resource)`, or `scope(target, channels?)`.
- Bare strings are invalid in `deny` and `only`.
- Isolation rules are additive through ancestors.
- Unknown isolation targets fail fast at bootstrap.
- Runtime operator APIs are gated only by the root resource's `isolate.exports` surface.
- `subtreeOf(resource)` matches by ownership subtree instead of id string matching.
- `scope(target, channels?)` applies channel-specific isolation rules such as `dependencies`, `listening`, `tagging`, or `middleware`.

```ts
.isolate({
  deny: [subtreeOf(adminResource), scope([internalEvent], { listening: false })],
})
```

Subtrees:

- `.subtree(policy)` can auto-attach middleware to nested tasks/resources.
- Subtrees can validate contained definitions.
- Validators are return-based:
  - return `SubtreeViolation[]` for normal policy failures
  - do not throw for expected validation failures

Forks and overrides:

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
- Tags are often the cleanest way to implement auto-discovery such as HTTP route registration, cron scheduling, cache warmers, or internal policies without manual registries.

Cron:

- `tags.cron` schedules tasks with cron expressions.
- Cron runs only when `resources.cron` is registered.
- One cron tag per task is supported.
- If `resources.cron` is not registered, cron tags remain metadata only.

## Async Context, Queue, and Remote Lanes

These are important features, but the full detail lives elsewhere.

Async Context:

- Defines request-local state on platforms that support `AsyncLocalStorage`.
- Use `r.asyncContext(...)` or `defineAsyncContext(...)`.
- Contexts can be provided, required by middleware, or injected as dependencies.
- If custom `serialize` and `parse` are omitted, Runner uses its default serializer.

Queue:

- `resources.queue` provides named FIFO queues.
- Each queue id gets its own isolated queue instance.
- `queue.run(id, task)` schedules work sequentially for that queue id.
- Disposal can cancel in-flight work via `AbortSignal`.

Remote Lanes (Node):

- Event lanes are async fire-and-forget routing for events.
- RPC lanes are synchronous cross-runner task or event calls.
- Supported modes:
  - `network`
  - `transparent`
  - `local-simulated`
- Async-context propagation over RPC lanes is allowlist-based.

References:

- `readmes/REMOTE_LANES_AI.md`
- `readmes/REMOTE_LANES.md`

## Validation, Errors, and Serialization

Validation:

- Use `check(value, patternOrSchema)` for runtime validation.
- Plain object patterns are strict by default.
- `Match.compile(pattern)` converts a pattern into a reusable schema object with `parse(...)`, `test(...)`, and JSON Schema export support.
- Use `Match.ObjectIncluding(...)` when unknown keys are allowed.
- Use `Match.MapOf(...)` for dynamic-key records.
- `Match.Lazy(...)` supports recursive patterns.
- `Match.Schema()` and `Match.Field()` support class-decorator schemas.
- `Match.fromSchema(Class)` is useful when consuming class-backed contracts.
- `Match.toJSONSchema(...)` exports JSON Schema for supported patterns.
- Builder schema slots accept the same validation sources everywhere: task input, task output, resource config, event payload, tag config, middleware config, and error data.

Errors:

- Use `r.error(...)` to define typed Runner errors.
- Helpers expose `new`, `create`, `throw`, and `is`.
- Helper-specific `.is(err)` is lineage-aware, so scoped/canonical helper clones still match the same Runner error reliably.
- `.httpCode(...)` and `.remediation(...)` enrich errors for transport and operator feedback.
- `r.error.is(err)` checks whether something is any Runner error.

Serialization:

- Runner ships with a serializer that round-trips common non-JSON shapes like `Date` and `RegExp`.
- Register custom types through `resources.serializer`.
- `@Serializer.Field(...)` lets class-based DTOs remap field names and transform wire values during serialize/deserialize.
- `@Serializer.Field(...)` composes well with `@Match.Schema()` and `@Match.Field(...)` when you want one DTO to both validate and map payloads.
- Prefer explicit schemas at trust boundaries.
- File uploads are handled by HTTP RPC transport helpers, not the generic serializer.

Serializer + Match example:

```ts
import { Match, Serializer } from "@bluelibs/runner";

@Match.Schema()
class UserDto {
  @Serializer.Field({ from: "user_id" })
  @Match.Field(Match.NonEmptyString)
  id!: string;

  @Serializer.Field({
    from: "created_at",
    deserialize: (value) => new Date(String(value)),
  })
  @Match.Field(Date)
  createdAt!: Date;
}

const serializer = new Serializer();
const user = serializer.deserialize(
  '{"user_id":"u1","created_at":"2026-03-06T10:00:00.000Z"}',
  { schema: UserDto },
  // serializer.parse(...) does deserialization + validation
);
```

Practical rule:

- Use `Match.compile(...)` for most contracts when you want both runtime validation and strong builder inference.
- Use plain Match patterns when runtime validation is enough or when the payload type is already explicit through builder generics.
- Use class DTOs when field remapping or reusable serializer transforms become central.

## Runtime, Lifecycle, Testing, and IDs

Runtime:

- `run(app, options?)` wires dependencies, initializes resources, emits lifecycle events, and returns the runtime API.
- Main runtime helpers:
  - `runTask`
  - `emitEvent`
  - `getResourceValue`
  - `getLazyResourceValue`
  - `getResourceConfig`
  - `getRootId`
  - `getRootConfig`
  - `getRootValue`
  - `dispose`
- Use `run(app, { debug: "verbose" })` for structured debug output.
- Use `run(app, { logs: { printThreshold: null } })` to silence console output.
- `dryRun: true` validates the graph without starting resources.
- `lazy: true` defers startup-unused resources until on-demand access.
- `lifecycleMode: "parallel"` enables dependency-safe parallel startup and disposal waves.
- `executionContext: true | { createCorrelationId?, cycleDetection? }` enables runtime execution context (opt-in). Import `{ system }` and read `system.ctx.executionContext.use()` or `.tryUse()` inside tasks, hooks, and interceptors. Runner assigns a correlation id to each top-level execution and enables cycle detection by default. Use `cycleDetection: false` to keep context/correlation ids without repetition-depth guards. Requires AsyncLocalStorage (Node-only in practice).
- `system.ctx.executionContext.use()` returns the current branch snapshot: `{ correlationId, startedAt, depth, currentFrame, frames }`.
- The execution chain includes nested task calls, event emissions, and hook executions. Parallel child tasks inherit the same `correlationId` and parent frames, then append their own branch-local frame.
- `system.ctx.executionContext.provide({ correlationId? }, fn)` seeds correlation at the execution boundary before you call `runTask()` / `emitEvent()`.
- `system.ctx.executionContext.record({ correlationId? }, fn)` returns `{ result, recording }` with the full recorded execution tree for that scope.
- Lifecycle:

- Startup order:
  - wire dependencies
  - `init` resources
  - lock runtime mutation surfaces
  - run `ready()`
  - emit `events.ready`
- Shutdown order:
  - run `cooldown()`
  - emit `events.disposing`
  - drain in-flight work
  - emit `events.drained`
  - run `dispose()`

Testing:

- In unit tests, build the smallest root resource that expresses the contract you care about.
- Run it with `await run(app)`.
- Assert through `runTask`, `emitEvent`, `getResourceValue`, or `getResourceConfig`.
- `r.override(base, fn)` is the standard way to swap behavior in tests while preserving ids.

IDs:

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

## File Structure

- Prefer feature-driven folders.
- Prefer naming by Runner item type:
  - `*.task.ts`
  - `*.resource.ts`
  - `*.event.ts`
  - `*.hook.ts`
  - `*.middleware.ts`
  - `*.tag.ts`
  - `*.error.ts`

## Observability

- `resources.logger` is the built-in structured logger.
- Loggers support `trace`, `debug`, `info`, `warn`, `error`, and `critical`.
- `logger.with({ source, additionalContext })` creates contextual child loggers that share the same root listeners and buffering.
- `logger.onLog(async (log) => { ... })` lets you forward, redact, or collect logs without routing them through the event system.
- `run(app, { logs: { printThreshold, printStrategy, bufferLogs } })` controls printing and startup buffering.
- Prefer stable `source` ids and low-cardinality context fields such as `requestId`, `taskId`, or `tenantId`.

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
