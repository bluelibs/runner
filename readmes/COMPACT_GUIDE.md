# BlueLibs Runner: Compact Guide

Runner is a strongly typed application composition framework built around explicit contracts.
You declare a graph of resources, tasks, events, hooks, middleware, tags, and errors, then `run(app)` turns that graph into a constrained runtime with validation, lifecycle, isolation, and observability built in.

Think "architecture as runtime-enforced structure", not "some modules that hopefully cooperate".

## Mental Model

- `resource`: singleton with lifecycle (`init`, `ready`, `cooldown`, `dispose`)
- `task`: typed business action with DI, middleware, and validation
- `event`: typed signal
- `hook`: reaction subscribed to an event
- `middleware`: cross-cutting wrapper around a task or resource
- `tag`: typed metadata for discovery and policy
- `error`: typed Runner error helper
- `run(app)`: bootstraps the graph and returns the runtime API

Prefer the built-in flat globals exported by Runner:

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

## Core Rules

- Fluent builders chain methods and end with `.build()`.
- Configurable built definitions expose `.with(config)`.
- `r.task<Input>(id)` and `r.resource<Config>(id)` can seed typing before explicit schemas.
- User ids are local ids. They cannot contain `.`.
  Use `send-email`, not `app.tasks.sendEmail`.
- Reserved local ids fail fast: `tasks`, `resources`, `events`, `hooks`, `tags`, `errors`, `asyncContexts`.
- Ids cannot start or end with `.`, and cannot contain `..`.
- Builder order is enforced. After terminal methods such as `.run()` or `.init()`, mutation surfaces intentionally narrow.
- List builders append by default. Pass `{ override: true }` to replace.
- `.meta({ ... })` is available across builders for docs and tooling.
- Prefer local ids such as `task("createUser")`. Runner composes canonical ids from the owner subtree at runtime.
- Runtime and store internals always expose canonical ids.

### Schemas

- `.schema()` is the unified alias:
  - task -> input schema
  - resource -> config schema
  - event -> payload schema
  - error -> data schema
- Explicit aliases still exist when they read better:
  - `.inputSchema(...)`, `.configSchema(...)`, `.payloadSchema(...)`, `.dataSchema(...)`
- Tasks use `.resultSchema()` for output validation.
- Schema slots accept: raw Match patterns, compiled Match schemas, decorator-backed classes, or any schema object exposing `parse(...)`.
- Schema resolution prefers `parse(input)` when present. Otherwise Runner compiles raw Match patterns once and reuses the compiled schema.
- Prefer `Match.compile(...)` when you want to reuse a schema value yourself or access `.pattern`, `.parse()`, `.test()`, and `.toJSONSchema()` directly.

```ts
import { Match, r } from "@bluelibs/runner";

const userInput = Match.compile({
  email: Match.Email,
  age: Match.Optional(Match.Integer),
});

const createUser = r
  .task("createUser")
  .inputSchema(userInput)
  .resultSchema({
    id: Match.NonEmptyString,
    email: Match.Email,
  })
  .run(async (input) => ({ id: "u1", ...input }))
  .build();

userInput.pattern;
userInput.parse({ email: "ada@example.com" });
userInput.test({ email: "ada@example.com" });
userInput.toJSONSchema();
```

## Runtime and Lifecycle

`run(app, options?)` wires dependencies, initializes resources, emits lifecycle events, and returns the runtime API.

Main runtime helpers: `runTask`, `emitEvent`, `getResourceValue`, `getLazyResourceValue`, `getResourceConfig`, `getHealth`, `dispose(options?)`.

The returned runtime also exposes: `runOptions`, `mode` (`"dev" | "prod" | "test"`), and `state` (`"running" | "paused"`).

Important run options:

- `dryRun: true`: validate the graph without running `init()` / `ready()` or starting ingress
- `lazy: true`: keep startup-unused resources asleep until `getLazyResourceValue(...)` wakes them, then runs their `ready()` on demand
- `lifecycleMode: "parallel"`: preserve dependency ordering, but run same-wave lifecycle hooks in parallel
- `shutdownHooks: true`: install graceful `SIGINT` / `SIGTERM` hooks; signals during bootstrap cancel startup and roll back initialized resources
- `signal: AbortSignal`: let an outer owner cancel bootstrap before readiness or start graceful runtime disposal after readiness (does not feed ambient execution cancellation)
- `dispose: { totalBudgetMs, drainingBudgetMs, abortWindowMs, cooldownWindowMs }`: control bounded shutdown timing
- `errorBoundary: true`: install process-level unhandled error capture and route it through `onUnhandledError`
- `executionContext: true | { ... }`: enable correlation ids and inherited execution signals, with optional frame tracking and cycle detection
- `identity: myIdentityContext`: override which registered async context Runner reads for identity-aware framework behavior
- `mode: "dev" | "prod" | "test"`: override environment-based mode detection

Observability options (`debug`, `logs`) do not change lifecycle semantics.

Useful examples:

- `run(app, { debug: "verbose" })` for structured debug output
- `run(app, { logs: { printThreshold: null } })` to silence console printing
- Node durable workflows expose task-scoped repositories via `durable.getRepository(workflowTask)` for typed execution inspection. Use `find(filters, { sort, limit, skip })` for lists, `findOne(filters)` / `findOneOrFail(filters)` for single reads, and `findTree(filters, { sort, limit, skip })` for recursive subflow trees.

Lifecycle order:

- Startup:
  - wire dependencies
  - run `init()` in dependency order
  - lock runtime mutation surfaces
  - run `ready()` in dependency order
  - emit `events.ready`
- Shutdown:
  - enter `coolingDown` -> run `cooldown()` in reverse dependency order
  - optionally keep broader admissions open for `dispose.cooldownWindowMs`
  - enter `disposing` -> emit `events.disposing`
  - drain in-flight work within remaining shutdown budget
  - if drain is still incomplete, enter `aborting` -> emit `events.aborting`, abort Runner-owned active task signals, then optionally wait `dispose.abortWindowMs`
  - emit `events.drained`
  - run `dispose()` in reverse dependency order

See Resources for detailed `cooldown()` semantics.

Disposal modes:

- `runtime.dispose()`: normal graceful path above.
- `runtime.dispose({ force: true })`: skip any graceful phases that have not started yet (cooldown, cooldownWindow, disposing event, drain, abortWindow, drained event) and jump directly to resource `dispose()` in reverse dependency order. Does not preempt lifecycle work already in flight.

Pause and recovery:

- `runtime.pause()` is synchronous and idempotent. It stops new runtime-origin task and event admissions immediately.
- `runtime.resume()` reopens admissions immediately.
- `runtime.recoverWhen({ everyMs, check })` registers paused-state recovery conditions. Runner auto-resumes only after all active conditions for the current pause episode pass.

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

## Serverless / AWS Lambda

- Treat the Lambda handler as a thin ingress adapter: parse the API Gateway event, provide request async context, then call `runtime.runTask(...)`.
- Cache the `run(app, { shutdownHooks: false })` promise across warm invocations so cold-start bootstrap happens once per container.
- Prefer task input schemas for business validation. Keep the handler focused on HTTP adaptation and error mapping.
- Require request-local business state with `r.asyncContext(...).require()` so missing context fails fast.
- Use an explicit `disposeRunner()` helper only in tests, local scripts, or environments where you truly control teardown.
- If an external host owns shutdown, prefer `run(app, { signal, shutdownHooks: false })` over forwarding that signal into business execution.

## Resources

Resources model shared services and state. They are Runner's primary composition and ownership unit.

- Start most apps with `const runtime = await run(appResource)`.
- `init(config, deps, context)` creates the value.
- `ready(value, config, deps, context)` starts ingress after startup lock.
- `cooldown(value, config, deps, context)` stops accepting new external work at shutdown start.
  Fully awaited before narrowing admissions; time counts against `dispose.totalBudgetMs`. During `coolingDown`, task runs and event emissions stay open; if `dispose.cooldownWindowMs > 0`, broader admissions stay open for an extra window after `cooldown()` completes. Once `disposing`, fresh admissions narrow to the cooling resource, definitions from `cooldown()`, and in-flight continuations. `runtime.dispose({ force: true })` skips `cooldown()`.
- `dispose(value, config, deps, context)` performs final teardown after drain. With `runtime.dispose({ force: true })`, this becomes the first resource lifecycle phase reached during shutdown.
- `health(value, config, deps, context)` is an optional probe returning `{ status: "healthy" | "degraded" | "unhealthy", message?, details? }`.
- Config-only resources can omit `.init()`. Their resolved value is `undefined`.
- Resource definitions expose `.extract(entry)` to read config from a matching `resource.with(...)` entry.
- `.context(() => initialContext)` can hold mutable resource-local state shared across lifecycle phases.
- If you register something, you are a non-leaf resource. Non-leaf resources cannot be forked.

Use the lifecycle intentionally:

- `ready()` for HTTP listeners, consumers, schedulers, and other ingress
- `cooldown()` for stopping new work
- `dispose()` for final cleanup

Do not use `cooldown()` as a generic teardown phase for support resources such as databases.

Ownership and ids:

- User resources contribute their own ownership segment to canonical ids.
- The app resource passed to `run(...)` is a normal resource, so direct registrations compile under `app.*`.
- Child resources continue that chain, for example `app.billing.tasks.createInvoice`.
- `runtime-framework-root` is reserved and cannot be used as a user resource id.
- Runner creates two framework namespace resources:
  - `system`: locked internals (`resources.store`, `resources.eventManager`, `resources.taskRunner`, `resources.middlewareManager`, `resources.runtime`, lifecycle events)
  - `runner`: utility globals (`resources.mode`, `resources.health`, `resources.timers`, `resources.logger`, `resources.serializer`, `resources.queue`, core tags, middleware, framework errors)

Lazy resources:

- `getLazyResourceValue(...)` is valid only before shutdown starts.
- Once the runtime enters `coolingDown` or later, startup-unused resources stay asleep and wakeup attempts fail fast.

Health reporting:

- Only resources that define `health()` participate. `resources.health` is the built-in reporter.
- Prefer `resources.health.getHealth()` inside resources; keep `runtime.getHealth()` for operator callers.
- Health APIs are valid only after `run(...)` resolves and before disposal starts.
- Sleeping lazy resources and resources without `health()` are skipped.
- Health results expose `{ totals, report, find(...) }`. Report entries: `{ id, initialized, status, message?, details? }`.
- If `health()` throws, Runner records that resource as `unhealthy` with the normalized error on `details`.
- When health shows temporary pressure or outage, prefer `runtime.pause()` and `runtime.recoverWhen(...)` over shutdown.

Dynamic registration callbacks receive the resolved mode:

```ts
const app = r
  .resource<{ enableDevTools: boolean }>("app")
  .register((config, mode) => [
    ...(config.enableDevTools && mode === "dev" ? [devToolsResource] : []),
  ])
  .build();
```

## Tasks

Tasks are the main business actions in Runner.

- Tasks are async functions with DI, middleware, validation, and typed output.
- Dependency maps are fail-fast validated. If `dependencies` is a function, it must resolve to an object map.
- Optional dependencies are explicit: `someResource.optional()`.
- `.throws([...])` declares error contracts for docs and tooling. It accepts Runner error helpers only and is declarative metadata, not runtime enforcement.
- Task `.run(input, deps, context)` always receives execution context as the third argument, never inside `deps`.

Task context includes:

- `journal`: typed per-execution state shared with middleware
- `source`: `{ kind, id }`, the canonical runtime source of the running task
- `signal`: the cooperative cancellation signal when execution context or boundary cancellation is active

For lifecycle-owned timers, prefer `resources.timers` inside a task or resource:

- `timers.setTimeout()` and `timers.setInterval()` are available during `init()`
- they stop accepting new timers once `cooldown()` starts
- pending timers are cleared during `dispose()`

### ExecutionJournal

`ExecutionJournal` is typed state scoped to one task execution designed for middleware comms.

- Use it when middleware and tasks need to share execution-local state.
- `journal.set(key, value)` fails if the key already exists. Pass `{ override: true }` when replacement is intentional.
- Create custom keys with `journal.createKey<T>(id)`.

## Events and Hooks

Events decouple producers from listeners. Hooks subscribe with:

- `.on(event)` for one exact event
- `.on(onAnyOf(...))` for tuple-friendly exact-event unions
- `.on(subtreeOf(resource))` for all visible events in a resource subtree
- `.on((event) => boolean)` for bootstrap-time predicate matching over registered events
- `.on([...])` to mix exact events, `subtreeOf(...)`, and predicates

Literal `"*"` stays standalone and cannot be used inside arrays.

Key rules:

- `.order(priority)` controls execution order. Lower numbers run first.
- `event.stopPropagation()` prevents downstream hooks from running.
- `.on("*")` listens to all visible events except those tagged with `tags.excludeFromGlobalHooks`.
- Selector-based hooks (`subtreeOf(...)`, predicates, or arrays containing them) resolve once at bootstrap and subscribe only to events visible to the hook on the `listening` channel.
- Exact direct event refs still fail fast on visibility violations; selector matches that are not visible are skipped.
- Selector-based hooks trade away payload autocomplete. Exact event refs and exact event tuples keep strong payload inference.
- `isOneOf()` is a runtime guard for Runner emissions that retain definition identity; arbitrary `{ id }`-shaped objects are not exact matches.
- `.parallel(true)` allows concurrent same-priority listeners.
- `.transactional(true)` makes listeners reversible. Each executed hook must return an async undo closure.

Transactional constraints fail fast:

- `transactional + parallel` is invalid
- `transactional + eventLane.applyTo(...)` is invalid

Emitters accept controls via `await event(payload, options?)`:

- `failureMode`: `"fail-fast"` or `"aggregate"`
- `throwOnError`: `true` by default
- `report: true`: return an execution report instead of relying only on exceptions

`report: true` returns:

```ts
{
  totalListeners,
  attemptedListeners,
  skippedListeners,
  succeededListeners,
  failedListeners,
  propagationStopped,
  errors,
}
```

For transactional events, fail-fast rollback is always enforced regardless of reporting mode.
If rollback handlers fail, Runner continues remaining rollbacks and throws a rollback failure that preserves the original trigger failure as the cause.

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

Core rules:

- Create task middleware with `r.middleware.task(id)`.
- Create resource middleware with `r.middleware.resource(id)`.
- Attach middleware with `.middleware([...])`.
- First listed middleware is the outermost wrapper.
- Runner validates targets:
  - task middleware attaches only to tasks or `subtree.tasks.middleware`
  - resource middleware attaches only to resources or `subtree.resources.middleware`
- Owner-scoped auto-application is available through `resource.subtree({ tasks/resources: { middleware: [...] } })`.
- Contract middleware can constrain task input and output types.
- Middleware definitions expose `.extract(entry)` to read config from a matching configured middleware attachment.
- When a runtime predicate must match one exact definition, prefer `isSameDefinition(candidate, definitionRef)` over comparing public ids directly, including configured wrappers such as `resource.with(...)` and middleware `.with(...)`.

Task vs resource middleware:

- Task middleware wraps task execution and usually handles auth, retry, cache, tracing, rate limits, fallbacks, or request policies.
- Resource middleware wraps resource initialization and value resolution and usually handles startup retry or timeout.
- Canonical ids differ:
  - task middleware -> `app.middleware.task.name`
  - resource middleware -> `app.middleware.resource.name`

Global interception is also available through:

- `taskRunner.intercept(...)`
- `eventManager.intercept(...)`
- `middlewareManager.intercept("task" | "resource", ...)`

Install those inside a resource `init()`.

Built-in resilience middleware:

- task: `cache`, `concurrency`, `circuitBreaker`, `debounce`, `throttle`, `fallback`, `rateLimit`, `retry`, `timeout`
- resource: `retry`, `timeout`
- non-resilience helper: `middleware.task.requireContext.with({ context })`

Config surfaces:

- `cache.with({ ttl, max, ttlAutopurge, keyBuilder, identityScope })`
- `concurrency.with({ limit, key?, semaphore? })`
- `circuitBreaker.with({ failureThreshold, resetTimeout })`
- `debounce.with({ ms, keyBuilder?, maxKeys? })`
- `throttle.with({ ms, keyBuilder?, maxKeys? })`
- `fallback.with({ fallback })`
- `identityChecker.with({ tenant?, user?, roles? })`
- `rateLimit.with({ windowMs, max, keyBuilder?, maxKeys? })`
- `retry.with({ retries, stopRetryIf, delayStrategy })`
- `timeout.with({ ttl })`

Operational notes:

- Register `resources.cache` in a parent resource before using task cache middleware.
- `cache.keyBuilder(canonicalTaskId, input)` may return either a plain key string or `{ cacheKey, refs? }`.
- Call `resources.cache.invalidateKeys(key | key[], options?)` to delete cached entries by concrete storage key, or opt into identity scoping for the provided base key.
- Call `resources.cache.invalidateRefs(ref | ref[])` to delete cached entries linked to semantic refs such as `user:123`.
- Order matters. Common pattern: `fallback` outermost, `timeout` inside `retry` when you want per-attempt budgets.
- Use `rateLimit` for quotas, `concurrency` for in-flight limits, `circuitBreaker` for fail-fast protection, `cache` for idempotent reads, and `debounce` / `throttle` for burst shaping.
- `cache`, `debounce`, `throttle` default to `canonicalTaskId + ":" + serialized input` partitioning and fail fast on non-serializable input. `rateLimit` defaults to `canonicalTaskId` (shared quota per task). The `canonicalTaskId` is the full runtime id, so sibling resources with the same local id don't share state by accident.
- See [Security](#security) for `identityScope` and identity-aware partitioning.
- `invalidateKeys(...)` is raw by default. Pass `invalidateKeys(key, { identityScope })` when you want Runner to scope the provided base key through the active identity namespace before invalidation.
- Cache refs stay raw. For tenant-aware invalidation, build refs through an app helper (e.g., `CacheRefs.getTenantId()`) so `keyBuilder` and `invalidateRefs(...)` share the same format.
- Middleware tags can enforce config contracts flowing into dependency callbacks, `run(...)`, `.with(...)`, `.config`, and `.extract(...)`.
- `tags.identityScoped`: middleware supports optional `identityScope`; subtree policy may fill or require it. See [Security](#security).

Built-in journal keys exist for middleware introspection, for example cache hits, retry attempts, circuit-breaker state, and timeout abort controllers.

## Data Contracts

### Validation

```ts
import { Match, check } from "@bluelibs/runner";
```

Core primitives:

- `check(value, pattern)` validates at runtime and returns the same value reference on success.
- `Match.compile(pattern)` creates reusable schemas with `.parse()`, `.test()`, and `.toJSONSchema()`.
- Match-native helpers and built-in tokens expose the same `.parse()`, `.test()`, and `.toJSONSchema()` surface directly.
- `type Output = Match.infer<typeof schema>` is the ergonomic type inference alias.
- Schema slots consume parse results, so class-backed schemas hydrate by default when used in `.inputSchema(...)`, `.configSchema(...)`, or `.payloadSchema(...)`.

Important rules:

- Hydration happens on `parse(...)`, not on `check(...)`. Class-schema hydration uses prototype assignment (no constructor call).
- Plain objects are strict by default. Use `Match.ObjectStrict(...)` for explicit strictness, `Match.ObjectIncluding(...)` when extra keys are allowed.
- Constructors act as matchers: `String`, `Number`, `Boolean`.
- Compiled schemas do not expose `.extend()`. Compose `compiled.pattern` into a new pattern and recompile.

Custom schema notes:

- The supported way to create reusable custom patterns is to compose Match-native helpers into named constants.
- `CheckSchemaLike<T>`: implement `parse(input): T`, optionally `toJSONSchema()`. Works for schema slots and `check(...)` but is not a nested Match-pattern extension point.
- In custom schemas, a normal thrown error is the right fit. Use `errors.matchError.new({ path: "$", failures: [...] })` only when you need Match-style failure metadata.

Common helpers: `NonEmptyString`, `Email`, `Integer`, `UUID`, `URL`, `Range({ min?, max?, inclusive?, integer? })`, `Optional(...)`, `OneOf(...)`, `ObjectIncluding(...)`, `MapOf(...)`, `ArrayOf(...)`, `Lazy(...)`, `Where(...)`, `WithMessage(...)`.

Decorator-backed schemas:

- `@Match.Schema({ base: BaseClass })`: subclassing without TypeScript `extends`.
- `@Match.Schema({ exact, schemaId, errorPolicy })`: controls strictness, schema identity, and aggregation policy.
- For legacy `experimentalDecorators`, import from `@bluelibs/runner/decorators/legacy`. No `emitDecoratorMetadata` or `reflect-metadata` needed.

Recursion and custom predicates:

- `Match.fromSchema(() => User)` for self-referencing or forward class-schema links.
- `Match.Lazy(() => pattern)` for recursive plain Match patterns.
- `Match.Where(...)` for runtime-only predicates or type guards (receives immediate parent in compound values). `Match.Where(..., messageOrFormatter)` is shorthand for `Match.WithMessage(...)`.
- Prefer built-ins, `RegExp`, or object patterns for precise JSON Schema export.

Validation errors:

- Validation failures throw `errors.matchError` with `.path` and flat `.failures`.
- `Match.WithMessage(...)` customizes the error headline: accepts a string, `{ message, code?, params? }`, or callback `({ value, error, path, pattern, parent? })`.
- `{ code, params }` copies metadata onto owned `failures[]` entries while preserving each leaf's raw `message`.
- For aggregate failures: `check(value, pattern, { errorPolicy: "all" })`, `Match.WithErrorPolicy(pattern, "all")`, or `@Match.Schema({ errorPolicy: "all" })`.

### Errors

Typed errors are declared once and usually registered + injected via DI, but the built helper also works locally outside `run(...)`.

```ts
const userNotFound = r
  .error<{ userId: string }>("userNotFound")
  .httpCode(404)
  .format((d) => `User '${d.userId}' not found`)
  .remediation((d) => `Verify user '${d.userId}' exists first.`)
  .build();

userNotFound.throw({ userId: "u1" });
userNotFound.new({ userId: "u1" });
userNotFound.is(err);
userNotFound.is(err, { severity: "high" });
r.error.is(err);
```

Important rules:

- `IRunnerError` exposes `.id`, `.data`, `.message`, `.httpCode`, and `.remediation`.
- `.dataSchema(...)` validates error data at throw time.
- `.throws([...])` on tasks, resources, hooks, and middleware accepts Runner error helpers only and remains declarative metadata.
- `.new()` / `.throw()` / `.is()` work even when the helper is used outside the Runner graph.
- Register the error when you want DI, discovery, or app definitions to depend on it.
- `errors.genericError` is the built-in fallback for ad-hoc message-only errors. Prefer domain-specific helpers when the contract is stable.

### Serialization

- The built-in serializer round-trips common non-JSON shapes (`Date`, `RegExp`). Register custom types through `resources.serializer`.
- For boundary-specific behavior, register a custom resource returning `new Serializer({...})` or fork `resources.serializer`.
- `allowedTypes: [...]` restricts deserialization. `new Serializer({ types: [...] })` pre-registers explicit `addType({ ... })` definitions.
- `serializer.addSchema(DtoClass)` / `new Serializer({ schemas: [...] })` registers `@Match.Schema()` DTOs so parse/deserialize restores them without an explicit `{ schema }`.
- `serializer.parse(payload, { schema })` for deserialization + validation in one step.
- `@Serializer.Field({ from, deserialize, serialize })` composes with `@Match.Field(...)` on `@Match.Schema()` classes.
- For legacy decorators, import from `@bluelibs/runner/decorators/legacy`.

## Testing

- In unit tests, build the smallest root resource that expresses the contract you care about.
- Run it with `await run(app)`. Assert through `runTask`, `emitEvent`, `getResourceValue`, or `getResourceConfig`.
- `r.override(base, fn)` is the standard way to swap behavior in tests while preserving ids.
- Duplicate override targets are allowed only in resolved `test` mode.
  The outermost declaring resource wins, and same-resource duplicates use the last declaration.

## Composition Boundaries

### Isolation

Runner treats composition boundaries as first-class.

Think of `.isolate(...)` as: `exports` (what the subtree exposes outward) and `deny`/`only`/`whitelist` (what consumers may wire to across boundaries).

Important rules:

- `exports: []` or `exports: "none"` makes the subtree private. Export entries must be explicit Runner definition or resource references.
- Runtime operator APIs such as `runTask`, `emitEvent`, and `getResourceValue` are gated only by the root resource's `isolate.exports` surface.
- `.isolate((config) => ({ ... }))` resolves once per configured resource instance.

Selectors: direct ref (one definition/resource/tag), `subtreeOf(resource, { types? })`, `scope(target, channels?)` where channels = `dependencies`/`listening`/`tagging`/`middleware`. String selectors only inside `scope(...)`: `scope("*")`, `scope("system.*")`. `subtreeOf` is ownership-based, not string-prefix-based.

Rules: `deny` (block), `only` (allow only), `whitelist` (exceptions only; doesn't override ancestors or make private exports public). Unknown selectors and violations fail fast at bootstrap.

Example:

```ts
.isolate({
  exports: [createInvoice],
  deny: [scope("system.*", { dependencies: true })],
  whitelist: [
    {
      for: [scope(subtreeOf(runnerDev), { dependencies: true })],
      targets: [scope("system.*", { dependencies: true })],
    },
  ],
})
```

### Subtrees

- `.subtree(policy)` / `.subtree([policyA, policyB])` / `.subtree((config) => policy | policy[])` auto-attaches middleware to nested tasks or resources.
- Same middleware id from subtree and local on one target fails fast.
- `subtree.validate` is generic (one function or array). Typed validation also available on `tasks`, `resources`, `hooks`, `events`, `tags`, `taskMiddleware`, `resourceMiddleware`.
- In validators, prefer `isSameDefinition(...)` over id comparison. Return `SubtreeViolation[]` for expected policy failures.

### Forks and Overrides

- `resource.fork(newId)` clones a leaf resource's identity (not structure) under a new id. Returns a built resource; do not call `.build()` again.
- Non-leaf resources cannot be forked. Compose a distinct parent for structural variants.

Overrides:

- Use `r.override(base, fn)` when you need to replace behavior while preserving the original id.
- For resources only, `r.override(resource, { context, init, ready, cooldown, dispose })` also supported. Object-form inherits unspecified hooks from base and may add new stages.
- `.overrides([...])` applies override definitions during bootstrap.
- Override direction is downstream-only: declare overrides from the resource that owns the target subtree or from one of its ancestors. Child resources cannot replace parent-owned or sibling-owned definitions.
- Override targets must already exist in the graph.
- Outside `test` mode, duplicate override targets fail fast. In `test`, the outermost declaring resource wins and same-resource duplicates use the last declaration.

## Tags and Scheduling

Tags are Runner's typed discovery system. They attach metadata to definitions, can affect framework behavior, and can be injected as typed accessors over matching definitions.

```ts
import { Match, r } from "@bluelibs/runner";

const httpRoute = r
  .tag("httpRoute")
  .for(["tasks"])
  .configSchema({
    method: Match.OneOf("GET", "POST"),
    path: Match.NonEmptyString,
  })
  .build();

const getHealth = r
  .task("getHealth")
  .tags([httpRoute.with({ method: "GET", path: "/health" })])
  .run(async () => ({ ok: true }))
  .build();
```

Key rules:

- Depending on a tag injects a typed accessor grouped by kind (`tasks`, `resources`, `events`, `hooks`, `taskMiddlewares`, `resourceMiddlewares`, `errors`). Tasks expose `definition`, `config`, `run(...)`; resources expose `definition`, `config`, `value`.
- `.for([...])` restricts which definition kinds can receive the tag.
- Tag config schemas accept the same schema types as other config surfaces.
- Contract tags can shape task or resource typing without changing runtime behavior.
- Built-in tags affect framework behavior: `tags.excludeFromGlobalHooks`, `tags.debug`, `tags.failWhenUnhealthy.with([db, cache])` (blocks task execution on `unhealthy` only; `degraded` still runs, bootstrap-time calls are not gated, sleeping lazy resources are skipped).
- Tags are often the cleanest way to implement route discovery, cron scheduling, cache warmers, or internal policies without manual registries.
- Prefer depending on the tag itself when you want discovery. Avoid injecting `resources.store` just to call `store.getTagAccessor(tag)` unless you also need other store-only APIs.

Use a normal tag dependency for normal dependency graph resolution. Use `tag.startup()` when the accessor must exist earlier, during bootstrap tree building.

```ts
const warmup = r.tag("warmup").for(["tasks"]).build();

const boot = r
  .resource("boot")
  .dependencies({
    runtimeWarmups: warmup,
    startupWarmups: warmup.startup(),
  })
  .build();

// `runtimeWarmups` resolves in the normal dependency graph.
// `startupWarmups` resolves earlier, in the startup dependency tree.
```

Cron:

- `tags.cron` schedules tasks with cron expressions via `tags.cron.with({ expression: "* * * * *" })`.
- Cron runs only when `resources.cron` is registered. One cron tag per task. Without `resources.cron`, cron tags remain metadata only.

## Context

Runner has two different async-context surfaces:

- `executionContext`: Runner-managed metadata such as `correlationId`, cancellation `signal`, and optional frame tracing
- `r.asyncContext(...)`: user-owned business state such as tenant, auth, locale, or request metadata

Do not treat them as the same feature just because they use the same async-local machinery under the hood.

### Execution Context

Use execution context for correlation ids, inherited execution signals, frame tracing, or cycle detection.

```ts
const runtime = await run(app, { executionContext: true });
// Lightweight: run(app, { executionContext: { frames: "off", cycleDetection: false } })

const myTask = r
  .task("myTask")
  .run(async () => {
    const execution = asyncContexts.execution.use();
    const { correlationId, signal } = execution;
    if (execution.framesMode === "full") { execution.frames; }
  })
  .build();
```

Key rules:

- `executionContext: true` enables full tracing. `{ frames: "off", cycleDetection: false }` keeps cheap signal inheritance + correlation ids only.
- Top-level `runTask` / `emitEvent` auto-create execution context when enabled; no `provide()` needed.
- `asyncContexts.execution.provide(...)` seeds external metadata at ingress. `record(...)` captures the tree for assertions/tracing (temporarily promotes to full frame tracking). Neither creates cancellation; they only propagate a signal you already provide.
- This is for Runner metadata, not business state.

Signal model:

- Pass a signal at the boundary via `runTask(..., { signal })` or `emit(..., { signal })`. Nested calls inherit the ambient signal automatically.
- The first signal becomes the ambient signal. Explicit nested signals stay local to that child.

Cancellation surfaces: tasks read `context.signal`, hooks read `event.signal`, injected emitters accept `emit(payload, { signal })`, timeout middleware uses the same path. No source = `undefined` (no shared fake signal).

Cycle protection layers: declared `.dependencies(...)` cycles fail at bootstrap; hook-driven event bounces fail at bootstrap; dynamic runtime loops need full frame tracking + cycle detection enabled.

Requires `AsyncLocalStorage`. Fails fast with a typed context error on unsupported runtimes.

### Async Context

Use `r.asyncContext(...)` for request-local business state.

```ts
import { r } from "@bluelibs/runner";

const tenantCtx = r.asyncContext<string>("tenantId").build();

await tenantCtx.provide("acme-corp", () =>
  runtime.runTask(handleRequest, input),
);

const myTask = r
  .task("myTask")
  .run(async () => {
    const tenantId = tenantCtx.use();
  })
  .build();
```

Key rules:

- Defines serializable business state scoped to one async execution tree, including nested `run()` calls.
- Builder: `.schema()` / `.configSchema()`, `.serialize()`, `.parse()`, `.meta()`, `.build()`. Runtime: `provide()`, `use()`, `tryUse()`, `has()`, `require()`, `optional()`.
- `.schema()` validates values on `provide(...)`. Declare `.schema()` before custom `.serialize()` or `.parse()`.
- Injectable as dependencies; register before injecting as required. Use `ctx.optional()` for conditional registration.
- `middleware.task.requireContext.with({ context })` / `ctx.require()` enforces required context.
- Custom `serialize`/`parse` supports RPC lane propagation. Remote lanes hydrate only allowlisted contexts via `eventLane.asyncContexts([...])` or `rpcLane.asyncContexts([...])`.

Requires `AsyncLocalStorage` for propagation.

### Security

Runner provides hooks to propagate identity, partition state, and enforce access rules. Authentication is your app's responsibility. The default pattern uses a shared identity async context (`asyncContexts.identity`). For extra fields like `userId`, define your own context, register it, and pass to `run(..., { identity })`. If not already in the graph, `run(...)` auto-registers it.

```ts
const identity = r
  .asyncContext<{ tenantId: string; userId: string }>("appTenant")
  .configSchema({ tenantId: String, userId: String })
  .build();

const app = r.resource("app").register([identity, listProjects]).build();
const runtime = await run(app, { identity });

await identity.provide({ tenantId: "acme", userId: "u1" }, () =>
  runtime.runTask(listProjects),
);
```

Identity API: `use()` (throws when missing), `tryUse()` (returns `undefined`), `has()` (boolean), `require()` (presence only, no optional field validation). Provide at ingress via `identity.provide({ tenantId }, fn)`.

Constraints: `tenantId` must be non-empty, no `:`, not `__global__`. `roles` must be string array, no empty entries. Identity is the async-context payload for partitioning and gates, not an identity-provider abstraction.

Identity-aware middleware (`cache`, `rateLimit`, `debounce`, `throttle`, `concurrency`) automatically use the tenant keyspace when identity context exists, even when you omit `identityScope`.

`identityScope` controls middleware key partitioning:

| Scope | Behavior |
|-------|----------|
| *(omit)* | Default tenant scope. Cross-tenant sharing only when no identity context exists. |
| `{ tenant: false }` | Disable identity-based partitioning; shared keyspace. |
| `{ tenant: true }` | Require `tenantId`; partition as `<tenantId>:...` |
| `{ tenant: true, user: true }` | Require `tenantId` + `userId`; partition as `<tenantId>:<userId>:...` |
| `{ required: false, tenant: true }` | Optional `<tenantId>:...` partitioning. |
| `{ required: false, tenant: true, user: true }` | Optional `<tenantId>:<userId>:...` partitioning. |

When `identityScope` object is present with `tenant: true`, `required` defaults to `true`. Missing required identity fields fail fast with `identityContextRequiredError`.

If your SaaS only has users and no real tenant model, provide a constant tenant such as `tenantId: "app"` at ingress and use `{ tenant: true, user: true }` for per-user buckets.

Cache refs stay raw. For tenant-aware or user-aware invalidation, build refs through an app helper such as `CacheRefs.getTenantId()` so `keyBuilder` and `invalidateRefs(...)` share the exact same ref format.
Cache key invalidation is raw by default. If `identityScope` prefixes stored keys, either pass the full scoped key yourself, for example `acme:profile`, or opt into helper scoping with `cache.invalidateKeys("profile", { identityScope: { tenant: true } })`.

Task identity gates (separate from middleware partitioning):

- `subtree({ tasks: { identity: {} } })`: requires tenant. `{ user: true }`: tenant + user. `{ roles: ["ADMIN"] }`: tenant + at least one role.
- Declarative sugar for `identityChecker` middleware. Roles are OR within one gate, AND across nested layers.
- `middleware.task.identityChecker.with(...)` is a task gate (not key partitioning). Implies tenant by default; `user: true` adds `userId`; `roles` require at least one match.
- Runner treats `roles` literally; expand inherited hierarchies before `identity.provide(...)` and gate on the lowest role needed.

Explicit identity-sensitive config fails fast at boot without `AsyncLocalStorage`. `asyncContexts.identity` degrades gently: `tryUse()` returns `undefined`, `has()` returns `false`, `provide()` still executes. `run(..., { identity: custom })` fails fast without `AsyncLocalStorage`.

## Queue

`resources.queue` provides named FIFO queues. Each queue id gets its own isolated instance.

- `queue.run(id, task)` schedules work sequentially for that queue id.
- Each queued task receives `(signal: AbortSignal) => Promise<void>`.
- `queue.dispose()` drains queued work and lets the active task finish. `queue.dispose({ cancel: true })` aborts the active task cooperatively and rejects queued-but-not-started work.
- `resources.queue` uses cancel mode during teardown and awaits every queue before disposal completes.

Always respect the signal in tasks that may be cancelled.

## Observability

- `resources.logger`: built-in structured logger (`trace`, `debug`, `info`, `warn`, `error`, `critical`).
- `logger.with({ source, additionalContext })` creates child loggers sharing root listeners and buffering.
- `logger.onLog(async (log) => { ... })` for forwarding, redaction, or collection (does not route through the event system).
- To log an error with stack trace, pass the `Error` object:

```ts
try {
  await processPayment(order);
} catch (error) {
  await logger.error("Payment processing failed", {
    error: error instanceof Error ? error : new Error(String(error)),
    data: { orderId: order.id, amount: order.total },
  });
}
```

- Runner extracts `error.name`, `error.message`, and `error.stack` into the structured log entry.
- `run(app, { logs: { printThreshold, printStrategy, bufferLogs } })` controls printing and startup buffering.
- Prefer stable `source` ids and low-cardinality context fields such as `requestId`, `taskId`, or `tenantId`.

## Project Structure

Prefer feature-driven folders and naming by Runner item type:

- `*.task.ts`
- `*.resource.ts`
- `*.event.ts`
- `*.hook.ts`
- `*.task-middleware.ts`
- `*.resource-middleware.ts`
- `*.tag.ts`
- `*.error.ts`

## See Also

- **Durable Workflows**: Replay-safe checkpoints for long-running flows. Use `step(id, fn)`, `sleep(ms)`, `waitForSignal(...)`, and `waitForExecution(...)` to model durable progress while the store remains the source of truth and queue/pubsub or polling wakes work back up. See `readmes/DURABLE_WORKFLOWS.md`.
- **Remote Lanes**: Scale Runner across processes without changing domain definitions. Event Lanes are async, queue-based; RPC Lanes are sync, request/response. Only lane-assigned work is rerouted. See `readmes/REMOTE_LANES.md`.
