# BlueLibs Runner: AI Field Guide

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
- Reserved local ids fail fast:
  - `tasks`
  - `resources`
  - `events`
  - `hooks`
  - `tags`
  - `errors`
  - `asyncContexts`
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
  - `.inputSchema(...)`
  - `.configSchema(...)`
  - `.payloadSchema(...)`
  - `.dataSchema(...)`
- Tasks use `.resultSchema()` for output validation.
- Schema slots accept:
  - raw Match patterns
  - compiled Match schemas
  - decorator-backed classes
  - any schema object exposing `parse(...)`
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

Main runtime helpers:

- `runTask`
- `emitEvent`
- `getResourceValue`
- `getLazyResourceValue`
- `getResourceConfig`
- `getHealth`
- `dispose(options?)`

The returned runtime also exposes:

- `runOptions`: the normalized effective `run(...)` options
- `mode`: `"dev" | "prod" | "test"`
- `state`: `"running" | "paused"`

Important run options:

- `dryRun: true`: validate the graph without running `init()` / `ready()` or starting ingress
- `lazy: true`: keep startup-unused resources asleep until `getLazyResourceValue(...)` wakes them, then run their `ready()` when they initialize
- `lifecycleMode: "parallel"`: preserve dependency ordering, but run same-wave lifecycle hooks in parallel
- `shutdownHooks: true`: install graceful `SIGINT` / `SIGTERM` hooks; signals during bootstrap cancel startup and roll back initialized resources
- `signal: AbortSignal`: let an outer owner start graceful runtime disposal without feeding ambient execution cancellation
- `dispose: { totalBudgetMs, drainingBudgetMs, cooldownWindowMs }`: control bounded shutdown timing
- `errorBoundary: true`: install process-level unhandled error capture and route it through `onUnhandledError`
- `executionContext: true | { ... }`: enable correlation ids and inherited execution signals, with optional frame tracking and cycle detection
- `mode: "dev" | "prod" | "test"`: override environment-based mode detection

Observability options do not change lifecycle semantics:

- `debug`
- `logs`

Useful examples:

- `run(app, { debug: "verbose" })` for structured debug output
- `run(app, { logs: { printThreshold: null } })` to silence console printing

Lifecycle order:

- Startup:
  - wire dependencies
  - run `init()` in dependency order
  - lock runtime mutation surfaces
  - run `ready()` in dependency order
  - emit `events.ready`
- Shutdown:
  - enter `coolingDown`
  - run `cooldown()` in reverse dependency order
  - optionally keep broader admissions open for `dispose.cooldownWindowMs`
  - enter `disposing`
  - emit `events.disposing`
  - drain in-flight work within the remaining shutdown budget
  - emit `events.drained`
  - run `dispose()` in reverse dependency order

Disposal modes:

- `runtime.dispose()` is the normal graceful path above.
- `runtime.dispose({ force: true })` is a manual fast path:
  - skip `cooldown()`
  - skip `dispose.cooldownWindowMs`
  - skip `events.disposing`
  - skip drain wait
  - skip `events.drained`
  - jump directly to resource `dispose()` in reverse dependency order

Pause and recovery:

- `runtime.pause()` is synchronous and idempotent. It stops new runtime-origin task and event admissions immediately.
- `runtime.resume()` reopens admissions immediately.
- `runtime.recoverWhen({ everyMs, check })` registers paused-state recovery conditions. Runner auto-resumes only after all active conditions for the current pause episode pass.

Mode access:

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

## Serverless / AWS Lambda

- Treat the Lambda handler as a thin ingress adapter: parse the API Gateway event, provide request async context, then call `runtime.runTask(...)`.
- Cache the `run(app, { shutdownHooks: false })` promise across warm invocations so cold-start bootstrap happens once per container.
- Prefer task input schemas for business validation. Keep the handler focused on HTTP adaptation and error mapping.
- Require request-local business state with `r.asyncContext(...).require()` so missing context fails fast.
- Use an explicit `disposeRunner()` helper only in tests, local scripts, or environments where you truly control teardown.
- If an external host owns shutdown, prefer `run(app, { signal, shutdownHooks: false })` over forwarding that signal into business execution.
- See `examples/aws-lambda-quickstart` for examples.

## Resources

Resources model shared services and state. They are Runner's primary composition and ownership unit.

- Start most apps with `const runtime = await run(appResource)`.
- `init(config, deps, context)` creates the value.
- `ready(value, config, deps, context)` starts ingress after startup lock.
- `cooldown(value, config, deps, context)` stops accepting new external work quickly at shutdown start.
  Runner fully awaits it before narrowing admissions, and its time still counts against the remaining `dispose.totalBudgetMs` budget.
  During `coolingDown`, task runs and event emissions stay open; if `dispose.cooldownWindowMs > 0`, Runner keeps that broader admission policy open for the extra bounded window after `cooldown()` completes.
  Once `disposing` begins, fresh admissions narrow to the cooling resource itself, any additional resource definitions returned from `cooldown()`, and in-flight continuations.
  `runtime.dispose({ force: true })` skips `cooldown()` entirely.
- `dispose(value, config, deps, context)` performs final teardown after drain.
  With `runtime.dispose({ force: true })`, this becomes the first resource lifecycle phase reached during shutdown.
- `health(value, config, deps, context)` is an optional probe used by `resources.health.getHealth(...)` and `runtime.getHealth(...)`.
  Return `{ status: "healthy" | "degraded" | "unhealthy", message?, details? }`.
- Config-only resources can omit `.init()`. Their resolved value is `undefined`.
- `.context(() => initialContext)` can hold mutable resource-local state shared across lifecycle phases.
- If you register something, you are a non-leaf resource.
- Non-leaf resources cannot be forked.

Use the lifecycle intentionally:

- `ready()` for HTTP listeners, consumers, schedulers, and other ingress
- `cooldown()` for stopping new work immediately
- `dispose()` for final cleanup

Do not use `cooldown()` as a generic teardown phase for support resources such as databases.
Use it to stop new work; use `dispose()` for final cleanup.

Ownership and ids:

- User resources contribute their own ownership segment to canonical ids.
- The app resource passed to `run(...)` is a normal resource, so direct registrations compile under `app.*`.
- Child resources continue that chain, for example `app.billing.tasks.createInvoice`.
- Only the internal synthetic framework root is invisible to user-facing ids.
- `runtime-framework-root` is reserved and cannot be used as a user resource id.
- Runner also creates two real framework namespace resources:
  - `system`: owns locked internals such as `resources.store`, `resources.eventManager`, `resources.taskRunner`, `resources.middlewareManager`, `resources.runtime`, lifecycle events, and the internal system tag
  - `runner`: owns built-in utility globals such as `resources.mode`, `resources.health`, `resources.timers`, `resources.logger`, `resources.serializer`, `resources.queue`, core tags, middleware, and framework errors
- `system` and `runner` carry proper `.meta.title` and `.meta.description` for docs and tooling, even though the transparent `runtime-framework-root` stays internal-only.

Lazy resources:

- `getLazyResourceValue(...)` is valid only before shutdown starts.
- Once the runtime enters `coolingDown` or later, startup-unused resources stay asleep and wakeup attempts fail fast.

Health reporting:

- Only resources that define `health()` participate.
- `resources.health` is the built-in health reporter resource.
- Prefer `resources.health.getHealth()` inside resources; keep `runtime.getHealth()` for operator callers.
- Health APIs are valid only after `run(...)` resolves and before disposal starts.
- Calling `getHealth()` during disposal or after `dispose()` starts is invalid.
- Sleeping lazy resources are skipped.
- Requested resources without `health()` are ignored.
- Health results expose `{ totals, report, find(...) }`.
- Report entries look like `{ id, initialized, status, message?, details? }`.
- `report.find(resourceOrId)` returns that resource entry or throws if it is not present.
- If `health()` throws, Runner records that resource as `unhealthy` and places the normalized error on `details`.
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
- `journal.set(key, value)` fails if the key already exists.
- Pass `{ override: true }` when replacement is intentional.
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
- `transactional + tags.eventLane` is invalid

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
- When a runtime predicate must match one exact definition, prefer `isSameDefinition(candidate, definitionRef)` over comparing public ids directly.

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

Important config surfaces:

- `cache.with({ ttl, max, ttlAutopurge, keyBuilder, tenantScope })`
- `concurrency.with({ limit, key?, semaphore? })`
- `circuitBreaker.with({ failureThreshold, resetTimeout })`
- `debounce.with({ ms, keyBuilder? })`
- `throttle.with({ ms, keyBuilder? })`
- `fallback.with({ fallback })`
- `rateLimit.with({ windowMs, max, keyBuilder? })`
- `retry.with({ retries, stopRetryIf, delayStrategy })`
- `timeout.with({ ttl })`

Operational notes:

- Register `resources.cache` in a parent resource before using task cache middleware.
- `cache.keyBuilder(taskId, input)` may return either a plain key string or `{ cacheKey, refs? }`.
- Call `resources.cache.invalidateRefs(ref | ref[])` to delete cached entries linked to semantic refs such as `user:123`.
- Order matters. Common pattern: `fallback` outermost, `timeout` inside `retry` when you want per-attempt budgets.
- Use `rateLimit` for quotas, `concurrency` for in-flight limits, `circuitBreaker` for fail-fast protection, `cache` for idempotent reads, and `debounce` / `throttle` for burst shaping.
- `rateLimit`, `debounce`, and `throttle` default to `taskId` partitioning. Pass `keyBuilder(taskId, input)` to partition by user, tenant, request context, or similar keys.
- When `tenantScope` is active, Runner prefixes internal middleware keys with `<tenantId>:`. Cache refs are scoped the same way as cache keys.
- Resource `retry` and `timeout` use the same semantics on `middleware.resource.*`.

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

- Hydration happens on `parse(...)`, not on `check(...)`.
- Class-schema hydration uses prototype assignment and does not call constructors during parse.
- Plain objects are strict by default.
- Prefer a plain object for the normal strict case, `Match.ObjectStrict(...)` when you want that strictness to be explicit, and `Match.ObjectIncluding(...)` when extra keys are allowed.
- Constructors act as matchers: `String`, `Number`, `Boolean`.
- Compiled schemas do not expose `.extend()`. Compose `compiled.pattern` into a new pattern and compile again.

Custom schema and pattern notes:

- The supported way to create reusable custom patterns is to compose Match-native helpers into named constants.
- `CheckSchemaLike<T>` is the minimal top-level custom schema contract: implement `parse(input): T`, and optionally `toJSONSchema()`.
- `CheckSchemaLike` works for schema slots and `check(...)`. It is not a public nested Match-pattern extension point.
- In a custom `CheckSchemaLike`, a normal thrown error or `errors.genericError` is the normal fit for validation failures.
  Use `errors.matchError.new({ path: "$", failures: [...] })` only when you intentionally want Match-style failure metadata at the top level.

Common helpers include:

- `NonEmptyString`
- `Email`
- `Integer`
- `UUID`
- `URL`
- `Range({ min?, max?, inclusive?, integer? })`
- `Optional(...)`
- `OneOf(...)`
- `ObjectIncluding(...)`
- `MapOf(...)`
- `ArrayOf(...)`
- `Lazy(...)`
- `Where(...)`
- `WithMessage(...)`

Decorator-backed schemas:

- `@Match.Schema({ base: BaseClass })` allows subclassing without TypeScript `extends`.
- `@Match.Schema({ exact, schemaId, errorPolicy })` controls strictness, schema identity, and default aggregation policy.
- Default decorator exports target standard ES decorators.
- For legacy `experimentalDecorators`, import `Match` and `Serializer` from `@bluelibs/runner/decorators/legacy`.
- Runner decorators do not require `emitDecoratorMetadata` or `reflect-metadata`.
- The default package initializes `Symbol.metadata` when missing, without replacing a native implementation.

Recursion and custom predicates:

- Use `Match.fromSchema(() => User)` for self-referencing or forward class-schema links.
- Use `Match.Lazy(() => pattern)` for recursive plain Match patterns.
- Use `Match.Where(...)` for runtime-only predicates or type guards.
- Prefer built-ins, `RegExp`, or object patterns when JSON Schema export needs to stay precise.
- `Match.Range({ min?, max?, inclusive?, integer? })` defaults to inclusive bounds; `inclusive: false` makes both bounds exclusive, and `integer: true` restricts the range to integers.
- Example: `Match.Range({ min: 5, max: 10, integer: true })`.
- `Match.Where(...)` receives the immediate parent when matching compound values.
- `Match.Where(..., messageOrFormatter)` is shorthand for `Match.WithMessage(Match.Where(...), messageOrFormatter)`.

Validation errors:

- Validation failures throw `errors.matchError`.
- The thrown error exposes `.path` and flat `.failures`.
- `Match.WithMessage(...)` customizes the error headline.
- `messageOrFormatter` can be a string, `{ message, code?, params? }`, or a callback.
- In callback form, `ctx` is `{ value, error, path, pattern, parent? }`.
- When `{ code, params }` is provided, Runner copies that metadata onto owned `failures[]` entries while keeping each leaf failure's raw `message` intact.
- Use `check(value, pattern, { errorPolicy: "all" })`, `Match.WithErrorPolicy(pattern, "all")`, or `@Match.Schema({ errorPolicy: "all" })` when you want aggregate failures.

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

- The built-in serializer round-trips common non-JSON shapes such as `Date` and `RegExp`.
- Register custom types through `resources.serializer`.
- Use `serializer.parse(payload, { schema })` when you want deserialization and validation in one step.
- `@Serializer.Field({ from, deserialize, serialize })` composes with `@Match.Field(...)` on `@Match.Schema()` classes for explicit DTOs.
- For legacy decorators, import `Serializer` from `@bluelibs/runner/decorators/legacy`.

## Testing

- In unit tests, build the smallest root resource that expresses the contract you care about.
- Run it with `await run(app)`.
- Assert through `runTask`, `emitEvent`, `getResourceValue`, or `getResourceConfig`.
- `r.override(base, fn)` is the standard way to swap behavior in tests while preserving ids.
- Duplicate override targets are allowed only in resolved `test` mode.
  The outermost declaring resource wins, and same-resource duplicates use the last declaration.

## Composition Boundaries

### Isolation

Runner treats composition boundaries as first-class.

Think of `.isolate(...)` as two controls on one boundary:

- `exports`: what the subtree exposes outward
- `deny` / `only` / `whitelist`: what consumers in the subtree may wire to across boundaries

Important rules:

- `exports: []` or `exports: "none"` makes the subtree private.
- Export entries must be explicit Runner definition or resource references.
- Runtime operator APIs such as `runTask`, `emitEvent`, and `getResourceValue` are gated only by the root resource's `isolate.exports` surface.
- `.isolate((config) => ({ ... }))` resolves once per configured resource instance.

Selector model:

- direct ref: one concrete definition, resource, or tag
- `subtreeOf(resource, { types? })`: everything owned by that resource subtree
- `scope(target, channels?)`: limit matching to selected channels such as `dependencies`, `listening`, `tagging`, or `middleware`
- string selectors are valid only inside `scope(...)`
  - `scope("*")`
  - `scope("system.*")`
  - `scope("app.resources.*")`
- `subtreeOf(resource)` is ownership-based, not string-prefix-based

Rule model:

- `deny`: block matching cross-boundary targets
- `only`: allow only matching cross-boundary targets
- `whitelist`: carve out exceptions for this boundary only

More isolation rules:

- `whitelist` does not override ancestor restrictions or make private exports public.
- `whitelist.for` and `whitelist.targets` accept the same selector forms as `deny` and `only`.
- Unknown selectors or targets that resolve to nothing fail fast at bootstrap.
- Violations fail during bootstrap wiring, not first runtime use.
- Legacy resource-level `exports` and fluent `.exports(...)` were removed in 6.x. Use `isolate: { exports: [...] }` or `.isolate({ exports: [...] })`.

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

Other common patterns:

- Channel-specific boundaries, for example `scope([internalEvent], { listening: false })`
- Task-only allowlists, for example `only: [subtreeOf(agentResource, { types: ["task"] })]`

### Subtrees

- `.subtree(policy)`, `.subtree([policyA, policyB])`, and `.subtree((config) => policy | policy[])` can auto-attach middleware to nested tasks or resources.
- If subtree middleware and local middleware resolve to the same middleware id on one target, Runner fails fast.
- Subtrees can validate contained definitions.
- `subtree.validate` is generic for compiled subtree definitions and can be one function or an array.
- Typed validation is also available on `tasks`, `resources`, `hooks`, `events`, `tags`, `taskMiddleware`, and `resourceMiddleware`.
- Generic and typed validators both run when they match the same compiled definition.
- Use the function form when subtree policy depends on resource config.
- Validators receive the compiled definition and should return `SubtreeViolation[]` for expected policy failures rather than throwing.

### Forks and Overrides

- `resource.fork(newId)` clones a leaf resource definition under a new id.
- Forks clone identity, not structure.
- Non-leaf resources cannot be forked.
- `.fork()` returns a built resource. Do not call `.build()` again.
- Compose a distinct parent resource when you need a structural variant of a non-leaf resource.
- Durable support is registered via `resources.durable`, while concrete durable backends use normal forks such as `resources.memoryWorkflow.fork("app-durable")`.

Overrides:

- Use `r.override(base, fn)` when you need to replace behavior while preserving the original id.
- For resources only, `r.override(resource, { context, init, ready, cooldown, dispose })` is also supported.
- Resource object-form overrides inherit unspecified lifecycle hooks from the base resource and may add stages the base resource did not define.
- Overriding resource `context` changes the private lifecycle-state contract shared across resource hooks.
- `.overrides([...])` applies override definitions during bootstrap.
- Override direction is downstream-only: declare overrides from the resource that owns the target subtree or from one of its ancestors.
- Child resources cannot replace parent-owned or sibling-owned definitions.
- Outside `test` mode, duplicate override targets fail fast.
  In `test`, the outermost declaring resource wins and same-resource duplicates use the last declaration.
- Override targets must already exist in the graph.

## Tags and Scheduling

Tags are Runner's typed discovery system.
They attach metadata to definitions, can affect framework behavior, and can be injected as typed accessors over matching definitions.

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

- Depending on a tag injects a typed accessor over matching definitions.
- `.for([...])` restricts which definition kinds can receive the tag.
- Tag config schemas accept the same schema types as other config surfaces.
- Contract tags can shape task or resource typing without changing runtime behavior.
- Built-in tags such as `tags.system`, `tags.debug`, and `tags.excludeFromGlobalHooks` affect framework behavior.
- `tags.debug` supports preset levels or fine-grained per-component config.
- `tags.failWhenUnhealthy.with([db, cache])` blocks task execution only when one of those resources reports `unhealthy`.
  `degraded` still runs, bootstrap-time task calls are not gated, and sleeping lazy resources stay skipped.
- Tags are often the cleanest way to implement route discovery, cron scheduling, cache warmers, or internal policies without manual registries.

Depending on a tag injects a typed accessor over all matching definitions. The accessor is grouped by kind (`tasks`, `resources`, `events`, `hooks`, `taskMiddlewares`, `resourceMiddlewares`, `errors`); task matches expose `definition`, `config`, and runtime `run(...)`, while resource matches expose `definition`, `config`, and runtime `value`.

Use a normal tag dependency when the accessor can resolve as part of the normal dependency graph. Use `tag.startup()` when the accessor must exist earlier, while Runner is building the startup dependency tree during bootstrap.

```ts
import { r } from "@bluelibs/runner";

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

- `tags.cron` schedules tasks with cron expressions.
- Attach it with `tags.cron.with({ expression: "* * * * *" })`.
- Cron runs only when `resources.cron` is registered.
- One cron tag per task is supported.
- Without `resources.cron`, cron tags remain metadata only.

## Context

Runner has two different async-context surfaces:

- `executionContext`: Runner-managed metadata such as `correlationId`, cancellation `signal`, and optional frame tracing
- `r.asyncContext(...)`: user-owned business state such as tenant, auth, locale, or request metadata

Do not treat them as the same feature just because they use the same async-local machinery under the hood.

### Execution Context

Use execution context when you want correlation ids, inherited execution signals, frame tracing, or runtime cycle detection.

```ts
const runtime = await run(app, { executionContext: true });

const fastRuntime = await run(app, {
  executionContext: { frames: "off", cycleDetection: false },
});

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
```

Important rules:

- `executionContext: true` enables full tracing.
- `executionContext: { frames: "off", cycleDetection: false }` keeps cheap signal inheritance and correlation ids without full frame bookkeeping.
- Top-level runtime task runs and event emissions automatically create execution context when enabled.
- You do not need `provide()` just to enable propagation.
- `asyncContexts.execution.provide(...)` seeds external metadata such as correlation ids or signals at an ingress boundary.
- `asyncContexts.execution.record(...)` captures the execution tree for assertions, tracing, or debugging.
- `record()` temporarily promotes lightweight execution context to full frame tracking for the recorded callback.
- `provide()` and `record()` do not create cancellation on their own. They only propagate a signal you already provide.
- `asyncContexts.execution` is for Runner metadata, not arbitrary business state.

Execution signal model:

- Pass a signal explicitly at the boundary with `runTask(..., { signal })` or `emit(..., { signal })`.
- Once execution context is enabled, nested calls can inherit that ambient execution signal automatically.
- The first signal attached to the execution tree becomes the ambient execution signal.
- Explicit nested signals stay local to that child call and do not rewrite the ambient signal for deeper propagation.

Cancellation surfaces:

- Tasks read `context.signal`.
- Hooks read `event.signal`.
- Injected event emitters accept `emit(payload, { signal })`.
- Low-level event-manager APIs accept merged call options such as `{ source, signal, report }`.
- RPC lane calls forward the active task or event signal automatically.
- Timeout middleware uses the same cooperative cancellation path.
- `middleware.task.timeout.journalKeys.abortController` remains available for middleware coordination and compatibility.
- If no cancellation source exists, `context.signal` and `event.signal` stay `undefined` rather than using a shared fake signal.

Cycle protection comes in layers:

- declared `.dependencies(...)` cycles fail at bootstrap, including middleware-aware graph validation
- declared hook-driven event bounce graphs fail at bootstrap event-emission validation
- dynamic runtime loops such as `task -> event -> hook -> task` need full execution-context frame tracking with cycle detection enabled

Platform note:

- Execution context requires `AsyncLocalStorage`.
- On runtimes without it, `run(..., { executionContext: ... })` fails fast with a typed context error.
- Direct calls to `asyncContexts.execution.provide()` or `.record()` throw a typed context error if async-local storage is unavailable.

### Async Context

Use `r.asyncContext(...)` for request-local business state.

```ts
import { r } from "@bluelibs/runner";

const tenantCtx = r.asyncContext<string>("tenantId");

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

- Async context defines serializable business state scoped to one async execution tree.
- Contexts can be injected as dependencies.
- `middleware.task.requireContext.with({ context })` enforces that required context exists.
- Custom `serialize` / `parse` support propagation over RPC lanes.
- Async context also requires `AsyncLocalStorage` for propagation.

### Multi-Tenant Systems

Runner's official same-runtime multi-tenant pattern uses `asyncContexts.tenant`.

- `tenant.use()` returns `{ tenantId: string }` and throws when missing.
- `tenant.tryUse()` returns the tenant value or `undefined`.
- `tenant.has()` is the safe boolean check.
- `tenant.require()` enforces tenant presence.
- Augment `TenantContextValue` when your app needs extra tenant metadata.
- Provide tenant identity at ingress with `tenant.provide({ tenantId }, fn)`.

Tenant-sensitive middleware such as `cache`, `rateLimit`, `debounce`, `throttle`, and `concurrency` default to `tenantScope: "auto"`:

- `"auto"`: partition by tenant when tenant context exists, otherwise use shared space
- `"required"`: fail fast when tenant context is missing
- `"off"`: always use the shared non-tenant space

Use `"off"` only when cross-tenant sharing is intentional, such as a truly global cache or semaphore namespace.

Platform note:

- Tenant propagation also depends on `AsyncLocalStorage`.
- On runtimes without it, `tenant.provide()` still runs the callback but does not propagate tenant state, so prefer safe accessors in multi-platform code.

## Queue

`resources.queue` provides named FIFO queues. Each queue id gets its own isolated instance.

- `queue.run(id, task)` schedules work sequentially for that queue id.
- Each queued task receives `(signal: AbortSignal) => Promise<void>`.
- `queue.dispose()` drains queued work without aborting the active task.
- `queue.dispose({ cancel: true })` is teardown mode: abort the active task cooperatively and reject queued-but-not-started work.
- `resources.queue` uses `queue.dispose({ cancel: true })` during runtime teardown and awaits every queue before the resource is considered disposed.

Always respect the signal in tasks that may be cancelled.

## Remote Lanes (Node)

Event lanes are async fire-and-forget routing for events across Runner instances.
RPC lanes are synchronous cross-runner task or event calls.

Supported modes:

- `network`
- `transparent`
- `local-simulated`

Async-context propagation over RPC lanes and event lanes is lane-allowlisted by default.

See:

- [REMOTE_LANES_AI.md](./REMOTE_LANES_AI.md)
- [REMOTE_LANES.md](./REMOTE_LANES.md)

## Observability

- `resources.logger` is the built-in structured logger.
- Loggers support `trace`, `debug`, `info`, `warn`, `error`, and `critical`.
- `logger.with({ source, additionalContext })` creates child loggers that share root listeners and buffering.
- `logger.onLog(async (log) => { ... })` lets you forward, redact, or collect logs without routing through the event system.
- To log an error with its stack trace, pass the actual `Error` object in the `error` field:

```ts
try {
  await processPayment(order);
} catch (error) {
  await logger.error("Payment processing failed", {
    // to preserve stacktrace:
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
