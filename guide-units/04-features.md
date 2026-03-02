## Structural Validation with `check()`

Use `check(value, patternOrSchema)` when you need strict runtime validation at boundaries.

- With `Match` patterns, `check()` returns the same input value, typed from the pattern.
- With schemas (`{ parse(input): T }`), `check()` returns parsed/transformed output.

Main inspiration and shoutout: Meteor's `check` package.

All supported Match patterns:

- Constructor patterns: `String`, `Number`, `Boolean`, `Function`, `Object`, `Array`, and class constructors (for example `Date`, `MyCustomClass`)
- Literal patterns: exact value matches for `string`, `number`, `boolean`, `bigint`, `symbol`, `null`, `undefined`
- Array item pattern: `[pattern]` means an array where every element matches that single pattern
- Strict object pattern: `{ a: String, b: Number }` (unknown keys are rejected)
- `Match.ObjectIncluding({ ... })`: object partial match (unknown keys allowed)
- `Match.Any`: accepts any value
- `Match.Integer`: accepts signed 32-bit integers
- `Match.NonEmptyString`: accepts non-empty strings
- `Match.Email`: accepts an email-shaped string
- `Match.UUID`: accepts canonical UUID strings (versions 1-8)
- `Match.URL`: accepts valid absolute URL strings
- `Match.IsoDateString`: accepts ISO datetime strings with timezone (`Z` or offset)
- `Match.RegExp(re)`: accepts strings that satisfy the provided regular expression (`RegExp` or source string)
- `Match.Lazy(() => pattern)`: lazily resolves recursive patterns
- `Match.fromSchema(Class, options?)`: validates plain objects using class decorator metadata
- `Match.Schema(options?)` / `Match.Field(pattern)`: optional decorator layer to build class-backed schemas
- `Match.NonEmptyArray()` / `Match.NonEmptyArray(pattern)`: accepts non-empty arrays (optionally validates each element)
- `Match.Optional(pattern)`: accepts `undefined` or `pattern`
- `Match.Maybe(pattern)`: accepts `undefined`, `null`, or `pattern`
- `Match.OneOf(...patterns)`: accepts any one candidate pattern
- `Match.Where((value) => boolean | value is T)`: custom predicate or type guard
- `Match.compile(pattern)`: wraps any pattern into a unified schema object with `{ pattern, parse(input), test(input), toJSONSchema(options?) }`
- `Match.test(value, pattern)`: boolean test helper (type guard-aware)
- `Match.Error`: error class thrown by failed pattern checks

Schema interoperability:

- `Match` helpers/patterns expose `.parse(input)`, so they can be used directly in `.inputSchema(...)`, `.resultSchema(...)`, and `.configSchema(...)`.
- `check()` also accepts any schema-like object with `parse(input): T` (optionally `toJSONSchema(): Record<string, unknown>` for tooling/serialization use-cases).
- Schema precedence in Runner definition APIs is: explicit `parse(input)` schema first; if absent, Runner validates via `check(pattern)` fallback.
- Class shorthand (for example `.configSchema(User)`) is supported when the class has `Match.Schema()` metadata.
- For a single reusable contract shape, use `Match.compile(pattern)` and pass the returned object wherever a schema is expected.

```typescript
import { Match, check } from "@bluelibs/runner";

const input = {
  userId: "u_1",
  retries: 3,
};

const validated = check(input, {
  userId: Match.NonEmptyString,
  retries: Match.Optional(Match.Integer),
});

validated.userId; // string
```

```typescript
import { Match, check } from "@bluelibs/runner";

class UserId {
  constructor(public readonly value: string) {}
}

check("ok", String);
check(42, Number);
check(true, Boolean);
check(() => undefined, Function);
check({ a: 1 }, Object);
check([1, 2], Array);
check(new UserId("u_1"), UserId);

check("admin", "admin");
check(1, 1);
check(null, null);
check(undefined, undefined);

check(["a", "b"], [String]);

check(
  { id: "u_1" },
  {
    id: Match.NonEmptyString,
  },
);

check(
  { id: "u_1", extra: true },
  Match.ObjectIncluding({
    id: Match.NonEmptyString,
  }),
);

check(12, Match.Integer);
check("value", Match.Any);
check("dev@example.com", Match.Email);
check("123e4567-e89b-42d3-a456-426614174000", Match.UUID);
check("https://example.com", Match.URL);
check("2026-01-01T10:20:30Z", Match.IsoDateString);
check("runner", Match.RegExp(/^runner$/));
check(["a"], Match.NonEmptyArray(String));
check("x", Match.Optional(String));
check(null, Match.Maybe(String));
check("abc", Match.OneOf(String, Number));
check(
  "ABC",
  Match.Where(
    (v: unknown): v is string => typeof v === "string" && v === "ABC",
  ),
);

const hasIdSchema = Match.ObjectIncluding({
  id: Match.NonEmptyString,
});
hasIdSchema.parse({ id: "u_1" }); // usable as IValidationSchema

const userSchema = Match.compile({
  id: Match.NonEmptyString,
  retries: Match.Optional(Match.Integer),
});
userSchema.parse({ id: "u_1" });
userSchema.test({ id: "u_1" });
userSchema.toJSONSchema();
check({ id: "u_1" }, userSchema);
```

### Decorator-backed Class Schemas

Use decorators when you prefer class ergonomics while keeping `check()`/`Match` contracts.

```typescript
import { Match, check } from "@bluelibs/runner";

@Match.Schema() // default: ObjectIncluding semantics
class User {
  @Match.Field(Match.NonEmptyString)
  name!: string;

  @Match.Field(Match.ArrayOf(Match.fromSchema(Item)))
  items!: Item[];
}

@Match.Schema()
class Item {
  @Match.Field(Match.NonEmptyString)
  title!: string;

  @Match.Field(Match.fromSchema(User))
  owner!: User;
}

const schema = Match.fromSchema(User);
check({ name: "Ada", items: [] }, schema);
```

- `Match.Schema({ exact: true })` switches class validation from ObjectIncluding behavior to strict key matching.
- `Match.Schema({ base: BaseClass | () => BaseClass })` lets one schema class compose another schema class without requiring TypeScript `extends`.
- `Match.fromSchema(Class)` returns a schema-like matcher compatible with `check()`, `.parse()`, and `.toJSONSchema()`.
- Bidirectional/self-referencing graphs (`User -> Item -> User`) are supported at runtime.
- `Match.Lazy(() => pattern)` is available for recursive non-class pattern graphs.

Why this is useful:

- Fail-fast validation at task/resource boundaries when inputs come from untyped surfaces.
- Precise failure paths (for example: `$.user.profile.email`) for fast debugging.
- Typed narrowing from validation patterns, including `Match.Where` type guards.
- Reusing existing `inputSchema` / `resultSchema`-style contracts directly in ad-hoc checks.
- Optional aggregate mode via `check(value, pattern, { throwAllErrors: true })`.

### Match.toJSONSchema()

Use `Match.toJSONSchema(pattern, options?)` to compile `Match` patterns into JSON Schema Draft 2020-12.

```typescript
import { Match } from "@bluelibs/runner";

const schema = Match.toJSONSchema({
  id: Match.NonEmptyString,
  retries: Match.Optional(Match.Integer),
});
```

Default behavior:

- `options.strict` defaults to `false`.
- When `strict` is `false`, `Match.Where(...)` is represented as a permissive schema node annotated with:
  - `description: "Custom runtime predicate from Match.Where; not representable in strict JSON Schema."`
  - `"x-runner-match-kind": "Match.Where"`

Strict fail-fast behavior (`{ strict: true }`):

- `Match.Where(...)` throws a `RunnerError` with id `runner.errors.check.jsonSchemaUnsupportedPattern`.
- All other unsupported constructs still throw in both modes.
- Error data includes `path`, `reason`, and `patternKind` to identify the exact unsupported node.

`Match.RegExp(...)` JSON Schema behavior:

- Converts to `type: "string"` + `pattern: re.source`.
- If the regex has flags, export remains non-failing (including `strict: true`) and includes metadata:
  - `description: "Regex flags are not represented by JSON Schema pattern and are ignored during schema export."`
  - `"x-runner-match-kind": "Match.RegExp"`
  - `"x-runner-regexp-flags": "..."`

`Match.fromSchema(...)` JSON Schema behavior:

- Recursive class graphs are emitted with `$defs/$ref` references.
- `schemaId` values are sanitized for JSON Schema definition keys and auto-deduplicated.

Supported conversion highlights:

- `Match.Any`, `Match.Integer`, `Match.NonEmptyString`, `Match.Email`, `Match.UUID`, `Match.URL`, `Match.IsoDateString`
- Constructor patterns: `String`, `Number`, `Boolean`, `Object`, `Array`
- Literal patterns: `string`, `number`, `boolean`, `null`
- Array patterns: `[pattern]`, `Match.NonEmptyArray()`, `Match.NonEmptyArray(pattern)`
- Object patterns with strict `additionalProperties: false`
- `Match.ObjectIncluding(...)` with `additionalProperties: true`
- `Match.OneOf(...)` -> `anyOf`

Unsupported in strict mode (fail-fast):

- `Match.Where(...)`
- `Function` constructor pattern
- Custom class constructor patterns
- Literal `undefined`, `bigint`, `symbol`
- `Match.Optional(...)` / `Match.Maybe(...)` outside object-property context

> **runtime:** "Your input said it was a number. It was a string wearing a number costume. I noticed."

## Caching

Avoid recomputing expensive work by caching task results with TTL-based eviction.
Cache is opt-in: you must register `globals.resources.cache`.

### Provider Contract

When you provide a custom cache backend, this is the contract:

```typescript
import type { ICacheProvider } from "@bluelibs/runner";

interface CacheProviderOptions {
  ttl?: number;
  max?: number;
  ttlAutopurge?: boolean;
}

type CacheProviderFactory = (
  options: CacheProviderOptions,
) => Promise<ICacheProvider>;
```

Notes:

- `options` are merged from `globals.resources.cache.with({ defaultOptions })` and middleware-level cache options.
- `keyBuilder` is middleware-only and is not passed to the provider.
- `has()` is optional, but recommended when `undefined` can be a valid cached value.

### Default Usage

```typescript
import { r, globals } from "@bluelibs/runner";

const expensiveTask = r
  .task("app.tasks.expensive")
  .middleware([
    globals.middleware.task.cache.with({
      // lru-cache options by default
      ttl: 60 * 1000, // Cache for 1 minute
      keyBuilder: (taskId, input: { userId: string }) =>
        `${taskId}-${input.userId}`, // optional key builder
    }),
  ])
  .run(async (input: { userId: string }) => {
    // This expensive operation will be cached
    return await doExpensiveCalculation(input.userId);
  })
  .build();

// Global cache configuration
const app = r
  .resource("app.cache")
  .register([
    // You have to register it, cache resource is not enabled by default.
    globals.resources.cache.with({
      defaultOptions: {
        max: 1000, // Maximum items in cache
        ttl: 30 * 1000, // Default TTL
      },
    }),
  ])
  .build();
```

### Minimal Redis Provider Example

```typescript
import { r, globals } from "@bluelibs/runner";
import Redis from "ioredis";

const redis = r
  .resource<{ url: string }>("app.resources.redis")
  .init(async ({ url }) => new Redis(url))
  .dispose(async (client) => client.disconnect())
  .build();

class RedisCache {
  constructor(
    private client: Redis,
    private ttlMs?: number,
    private prefix: string = "cache:",
  ) {}

  async get(key: string): Promise<unknown | undefined> {
    const value = await this.client.get(this.prefix + key);
    return value ? JSON.parse(value) : undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    const payload = JSON.stringify(value);
    if (this.ttlMs && this.ttlMs > 0) {
      await this.client.setex(
        this.prefix + key,
        Math.ceil(this.ttlMs / 1000),
        payload,
      );
      return;
    }
    await this.client.set(this.prefix + key, payload);
  }

  async clear(): Promise<void> {
    const keys = await this.client.keys(this.prefix + "*");
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }
}

const redisCacheProvider = r
  .resource("app.resources.cacheProvider.redis")
  .dependencies({ redis })
  .init(async (_config, { redis }) => {
    return async (options) => new RedisCache(redis, options.ttl);
  })
  .build();

const app = r
  .resource("app")
  .register([
    redis.with({ url: process.env.REDIS_URL! }),
    globals.resources.cache.with({ provider: redisCacheProvider }),
  ])
  .build();
```

**Why would you need this?** For monitoring and metrics—you want to know cache hit rates to optimize your application.

**Journal Introspection**: On cache hits the task `run()` isn't executed, but you can still detect cache hits from a wrapping middleware:

```typescript
import { r, globals } from "@bluelibs/runner";

const cacheJournalKeys = globals.middleware.task.cache.journalKeys;

const cacheLogger = r.middleware
  .task("app.middleware.cacheLogger")
  .run(async ({ task, next, journal }) => {
    const result = await next(task.input);
    const wasHit = journal.get(cacheJournalKeys.hit);
    if (wasHit) console.log("Served from cache");
    return result;
  })
  .build();

const myTask = r
  .task("app.tasks.cached")
  .middleware([cacheLogger, globals.middleware.task.cache.with({ ttl: 60000 })])
  .run(async () => "result")
  .build();
```

> **runtime:** "Because nobody likes waiting. Correct. You keep asking the same question like a parrot with Wi‑Fi, so I built a memory palace. Now you get instant answers until you change one variable and whisper 'cache invalidation' like a curse."

---

## Concurrency Control

Limit concurrent executions to protect databases and external APIs. The concurrency middleware keeps only a fixed number of task instances running at once.

```typescript
import { r, globals, Semaphore } from "@bluelibs/runner";

// Option 1: Simple limit (shared for all tasks using this middleware instance)
const limitMiddleware = globals.middleware.task.concurrency.with({ limit: 5 });

// Option 2: Explicit semaphore for fine-grained coordination
const dbSemaphore = new Semaphore(10);
const dbLimit = globals.middleware.task.concurrency.with({
  semaphore: dbSemaphore,
});

const heavyTask = r
  .task("app.tasks.heavy")
  .middleware([limitMiddleware])
  .run(async () => {
    // Max 5 of these will run in parallel
  })
  .build();
```

**Key benefits:**

- **Resource protection**: Prevent connection pool exhaustion.
- **Queueing**: Automatically queues excess requests instead of failing.
- **Timeouts**: Supports waiting timeouts and cancellation via `AbortSignal`.

> **runtime:** "Concurrency control: the bouncer of the event loop. I don't care how important your query is; if the room is full, you wait behind the velvet rope. No cutting, no exceptions."

---

## Circuit Breaker

Trip repeated failures early. When an external service starts failing, the circuit breaker opens so subsequent calls fail fast until a cool-down passes.

```typescript
import { r, globals } from "@bluelibs/runner";

const resilientTask = r
  .task("app.tasks.remoteCall")
  .middleware([
    globals.middleware.task.circuitBreaker.with({
      failureThreshold: 5, // Trip after 5 failures
      resetTimeout: 30000, // Stay open for 30 seconds
    }),
  ])
  .run(async () => {
    return await callExternalService();
  })
  .build();
```

**How it works:**

1. **CLOSED**: Everything is normal. Requests flow through.
2. **OPEN**: Threshold reached. All requests throw `CircuitBreakerOpenError` immediately.
3. **HALF_OPEN**: After `resetTimeout`, one trial request is allowed.
4. **RECOVERY**: If the trial succeeds, it goes back to **CLOSED**. Otherwise, it returns to **OPEN**.

**Why would you need this?** For alerting—you want to know when the circuit opens to alert on-call engineers.

**Journal Introspection**: Access the circuit breaker's state and failure count within your task (when it runs):

```typescript
import { r, globals } from "@bluelibs/runner";

const circuitBreakerJournalKeys =
  globals.middleware.task.circuitBreaker.journalKeys;

const myTask = r
  .task("app.tasks.monitored")
  .middleware([
    globals.middleware.task.circuitBreaker.with({
      failureThreshold: 5,
      resetTimeout: 30000,
    }),
  ])
  .run(async (_input, _deps, context) => {
    const state = context?.journal.get(circuitBreakerJournalKeys.state);
    const failures = context?.journal.get(circuitBreakerJournalKeys.failures); // number
    console.log(`Circuit state: ${state}, failures: ${failures}`);
    return "result";
  })
  .build();
```

> **runtime:** "Circuit Breaker: because 'hope' is not a resilience strategy. If the database is on fire, I stop sending you there to pour gasoline on it. I'll check back in thirty seconds to see if the smoke has cleared."

---

## Temporal Control: Debounce & Throttle

Control the frequency of task execution over time. Perfect for event-driven tasks that might fire in bursts.

```typescript
import { r, globals } from "@bluelibs/runner";

// Debounce: Run only after 500ms of inactivity
const saveTask = r
  .task("app.tasks.save")
  .middleware([globals.middleware.task.debounce.with({ ms: 500 })])
  .run(async (data) => {
    // Assuming db is available in the closure
    return await db.save(data);
  })
  .build();

// Throttle: Run at most once every 1000ms
const logTask = r
  .task("app.tasks.log")
  .middleware([globals.middleware.task.throttle.with({ ms: 1000 })])
  .run(async (msg) => {
    console.log(msg);
  })
  .build();
```

**When to use:**

- **Debounce**: Search-as-you-type, autosave, window resize events.
- **Throttle**: Scroll listeners, telemetry pings, high-frequency webhooks.

> **runtime:** "Temporal control: the mute button for your enthusiastic event emitters. You might be shouting a hundred times a second, but I'm only listening once per heartbeat."

---

## Fallback: The Plan B

Define what happens when a task fails. Fallback middleware lets you return a default value or execute an alternative path gracefully.

```typescript
import { r, globals } from "@bluelibs/runner";

const getPrice = r
  .task("app.tasks.getPrice")
  .middleware([
    globals.middleware.task.fallback.with({
      // Can be a static value, a function, or another task
      fallback: async (input, error) => {
        console.warn(`Price fetch failed: ${error.message}. Using default.`);
        return 9.99;
      },
    }),
  ])
  .run(async () => {
    return await fetchPriceFromAPI();
  })
  .build();
```

**Why would you need this?** For audit trails—you want to know when fallback values were used instead of real data.

**Journal Introspection**: The original task that throws won't continue execution, but you can detect fallback activation from a wrapping middleware:

```typescript
import { r, globals } from "@bluelibs/runner";

const fallbackJournalKeys = globals.middleware.task.fallback.journalKeys;

const fallbackLogger = r.middleware
  .task("app.middleware.fallbackLogger")
  .run(async ({ task, next, journal }) => {
    const result = await next(task.input);
    const wasActivated = journal.get(fallbackJournalKeys.active);
    const err = journal.get(fallbackJournalKeys.error);
    if (wasActivated) console.log(`Fallback used after: ${err?.message}`);
    return result;
  })
  .build();

const myTask = r
  .task("app.tasks.withFallback")
  .middleware([
    fallbackLogger,
    globals.middleware.task.fallback.with({ fallback: "default" }),
  ])
  .run(async () => {
    throw new Error("Primary failed");
  })
  .build();
```

> **runtime:** "Fallback: the 'parachute' pattern. If your primary logic decides to take a nap mid-flight, I'll make sure we land on a soft pile of default values instead of a stack trace."

---

## Rate Limiting

Protect your system from abuse by limiting the number of requests in a specific window of time.

```typescript
import { r, globals } from "@bluelibs/runner";

const sensitiveTask = r
  .task("app.tasks.login")
  .middleware([
    globals.middleware.task.rateLimit.with({
      windowMs: 60 * 1000, // 1 minute window
      max: 5, // Max 5 attempts per window
    }),
  ])
  .run(async (credentials) => {
    // Assuming auth service is available
    return await auth.validate(credentials);
  })
  .build();
```

**Key features:**

- **Fixed-window strategy**: Simple, predictable request counting.
- **Isolation**: Limits are tracked per task definition.
- **Error handling**: Throws `RateLimitError` when the limit is exceeded.

**Why would you need this?** For monitoring—you want to see remaining quota to implement client-side throttling.

**Journal Introspection**: When the task runs (request allowed), you can read the rate limit state from the execution journal:

```typescript
import { r, globals } from "@bluelibs/runner";

const rateLimitJournalKeys = globals.middleware.task.rateLimit.journalKeys;

const myTask = r
  .task("app.tasks.rateLimited")
  .middleware([
    globals.middleware.task.rateLimit.with({ windowMs: 60000, max: 10 }),
  ])
  .run(async (_input, _deps, context) => {
    const remaining = context?.journal.get(rateLimitJournalKeys.remaining); // number
    const resetTime = context?.journal.get(rateLimitJournalKeys.resetTime); // timestamp (ms)
    const limit = context?.journal.get(rateLimitJournalKeys.limit); // number
    console.log(
      `${remaining}/${limit} requests remaining, resets at ${new Date(resetTime)}`,
    );
    return "result";
  })
  .build();
```

> **runtime:** "Rate limiting: counting beans so you don't have to. You've had five turns this minute; come back when the clock says so."

---

## Require Context (Async Context Guard)

Fail fast when a task must run inside a specific async context. This middleware is useful for request-scoped metadata (request id, tenant id, auth claims) where continuing without context would produce incorrect behavior.

```typescript
import { r } from "@bluelibs/runner";

const RequestContext = r
  .asyncContext<{ requestId: string }>("app.ctx.request")
  .build();

const getAuditTrail = r
  .task("app.tasks.getAuditTrail")
  // Shortcut: creates globals.middleware.task.requireContext with this context
  .middleware([RequestContext.require()])
  .run(async () => {
    const { requestId } = RequestContext.use();
    return { requestId, entries: [] };
  })
  .build();
```

If you prefer the explicit middleware form (useful in documentation and composition helpers):

```typescript
import { r, globals } from "@bluelibs/runner";

const TenantContext = r
  .asyncContext<{ tenantId: string }>("app.ctx.tenant")
  .build();

const listProjects = r
  .task("app.tasks.listProjects")
  .middleware([
    globals.middleware.task.requireContext.with({ context: TenantContext }),
  ])
  .run(async () => {
    const { tenantId } = TenantContext.use();
    return await projectRepo.findByTenant(tenantId);
  })
  .build();
```

**What it protects you from:**

- Running tenant-sensitive logic without tenant context.
- Logging/auditing tasks that silently lose request correlation ids.
- Hidden bugs where context is only present in some call paths.

> **Platform Note:** Async context requires `AsyncLocalStorage`, which is **Node.js-only**. In browsers and edge runtimes, async context APIs are not available.

**What you just learned**: `requireContext` turns missing async context into an immediate, explicit failure instead of a delayed business-logic bug.

> **runtime:** "If your task needs request context and you forgot to bring it, we stop at the door. Better a loud crash now than a forensic investigation later."

---

## Retrying Failed Operations

For when things go wrong, but you know they'll probably work if you just try again. The built-in retry middleware makes your tasks and resources more resilient to transient failures.

```typescript
import { r, globals } from "@bluelibs/runner";

const flakyApiCall = r
  .task("app.tasks.flakyApiCall")
  .middleware([
    globals.middleware.task.retry.with({
      retries: 5, // Try up to 5 times
      delayStrategy: (attempt) => 100 * Math.pow(2, attempt), // Exponential backoff
      stopRetryIf: (error) => error.message === "Invalid credentials", // Don't retry auth errors
    }),
  ])
  .run(async () => {
    // This might fail due to network issues, rate limiting, etc.
    return await fetchFromUnreliableService();
  })
  .build();

const app = r.resource("app").register([flakyApiCall]).build();
```

The retry middleware can be configured with:

- `retries`: The maximum number of retry attempts (default: 3).
- `delayStrategy`: A function that returns the delay in milliseconds before the next attempt.
- `stopRetryIf`: A function to prevent retries for certain types of errors.

It also works on resources, which is especially useful for startup initialization:

```typescript
import { r, globals } from "@bluelibs/runner";

const database = r
  .resource<{ connectionString: string }>("app.db")
  .middleware([
    globals.middleware.resource.retry.with({
      retries: 4,
      delayStrategy: (attempt) => 250 * Math.pow(2, attempt),
    }),
  ])
  .init(async ({ connectionString }) => {
    return await connectToDatabase(connectionString);
  })
  .dispose(async (value) => {
    await value.close();
  })
  .build();
```

**Why would you need this?** For logging—you want to log which attempt succeeded or what errors occurred during retries.

**Journal Introspection**: Access the current retry attempt and the last error within your task:

```typescript
import { r, globals } from "@bluelibs/runner";

const retryJournalKeys = globals.middleware.task.retry.journalKeys;

const myTask = r
  .task("app.tasks.retryable")
  .middleware([globals.middleware.task.retry.with({ retries: 5 })])
  .run(async (_input, _deps, context) => {
    const attempt = context?.journal.get(retryJournalKeys.attempt); // 0-indexed attempt number
    const lastError = context?.journal.get(retryJournalKeys.lastError); // Error from previous attempt, if any
    if ((attempt ?? 0) > 0)
      console.log(`Retry attempt ${attempt} after: ${lastError?.message}`);
    return "result";
  })
  .build();
```

> **runtime:** "Retry: the art of politely head‑butting reality. 'Surely it'll work the fourth time,' you declare, inventing exponential backoff and calling it strategy. I'll keep the attempts ledger while your API cosplays a coin toss."

---

## Timeouts

The built-in timeout middleware prevents operations from hanging indefinitely by racing them against a configurable
timeout. Works for resources and tasks.

```typescript
import { r, globals } from "@bluelibs/runner";

const apiTask = r
  .task("app.tasks.externalApi")
  .middleware([
    // Works for tasks and resources via globals.middleware.resource.timeout
    globals.middleware.task.timeout.with({ ttl: 5000 }), // 5 second timeout
  ])
  .run(async () => {
    // This operation will be aborted if it takes longer than 5 seconds
    return await fetch("https://slow-api.example.com/data");
  })
  .build();

// Combine with retry for robust error handling
const resilientTask = r
  .task("app.tasks.resilient")
  .middleware([
    // Order matters here. Imagine a big onion.
    // Works for resources as well via globals.middleware.resource.retry
    globals.middleware.task.retry.with({
      retries: 3,
      delayStrategy: (attempt) => 1000 * attempt, // 1s, 2s, 3s delays
    }),
    globals.middleware.task.timeout.with({ ttl: 10000 }), // 10 second timeout per attempt
  ])
  .run(async () => {
    // Each retry attempt gets its own 10-second timeout
    return await unreliableOperation();
  })
  .build();
```

How it works:

- Uses AbortController and Promise.race() for clean cancellation
- Throws TimeoutError when the timeout is reached
- Works with any async operation in tasks and resources
- Integrates seamlessly with retry middleware for layered resilience
- Zero timeout (ttl: 0) throws immediately for testing edge cases

Best practices:

- Set timeouts based on expected operation duration plus buffer
- Combine with retry middleware for transient failures
- Use longer timeouts for resource initialization than task execution
- Consider network conditions when setting API call timeouts

Resource timeouts help prevent startup hangs when a dependency never becomes ready:

```typescript
import { r, globals } from "@bluelibs/runner";

const messageBroker = r
  .resource("app.broker")
  .middleware([
    globals.middleware.resource.timeout.with({ ttl: 15000 }),
    globals.middleware.resource.retry.with({ retries: 2 }),
  ])
  .init(async () => {
    return await connectBroker();
  })
  .dispose(async (value) => {
    await value.close();
  })
  .build();
```

> **runtime:** "Timeouts: you tie a kitchen timer to my ankle and yell 'hustle.' When the bell rings, you throw a `TimeoutError` like a penalty flag. It's not me, it's your molasses‑flavored endpoint. I just blow the whistle."

---

## HTTP Server Shutdown Pattern (`cooldown` + `dispose`)

For HTTP servers, split shutdown work into two phases:

- `cooldown()`: stop new intake immediately.
- `dispose()`: finish teardown after Runner (task/event) drain and lifecycle hooks complete.

```typescript
import express from "express";
import type { Server } from "node:http";
import { r } from "@bluelibs/runner";

type ServerContext = {
  app: express.Express;
  listener: Server | null;
  readiness: "up" | "down";
};

const httpServer = r
  .resource<{ port: number }>("app.http.server")
  .context<ServerContext>(() => ({
    app: express(),
    listener: null,
    readiness: "up",
  }))
  .init(async ({ port }, _deps, context) => {
    context.app.get("/health", (_req, res) => {
      const status = context.readiness === "up" ? 200 : 503;
      res.status(status).json({ status: context.readiness });
    });

    context.listener = context.app.listen(port);
    return context.listener;
  })
  .cooldown(async (listener, _config, _deps, context) => {
    // Intake-stop phase: fast and non-blocking in intent.
    context.readiness = "down";
    listener.close();
  })
  .dispose(async (_listener, _config, _deps, context) => {
    // Final teardown phase: force-close leftovers if needed.
    context.listener.closeAllConnections();
    context.listener.closeIdleConnections();
    context.listener = null;
  })
  .build();
```

Why this pattern works:

- `cooldown()` runs before `globals.events.disposing` and before drain wait, so it prevents new HTTP requests from entering.
- In-flight requests/tasks/events still get the normal drain window (`disposeDrainBudgetMs`).
- `dispose()` runs after drain, so cleanup can focus on leftovers only.
- This is the intended `cooldown()` shape: ingress resources that route to tasks/events.
- Infrastructure dependencies (database connections, cache clients, brokers) should usually skip `cooldown()` and only clean up in `dispose()`, so in-flight work can still finish during drain.

`cooldown()` can be async, but keep it short. Trigger intake stop and return quickly; let Runner's drain phase do the waiting.

---

## Cron Scheduling

Need recurring task execution without bringing in a separate scheduler process? Runner ships with a built-in global cron scheduler.

You mark tasks with `globals.tags.cron.with({...})`, and `globals.resources.cron` discovers and schedules them at startup. The cron resource is opt-in, so you must register it explicitly.

```typescript
import { r, globals } from "@bluelibs/runner";

const sendDigest = r
  .task("app.tasks.sendDigest")
  .tags([
    globals.tags.cron.with({
      expression: "0 9 * * *",
      timezone: "UTC",
      immediate: false,
      onError: "continue",
    }),
  ])
  .run(async () => {
    // send digest
  })
  .build();

const app = r
  .resource("app")
  .register([
    globals.resources.cron.with({
      // Optional: restrict scheduling to selected task ids/definitions.
      only: [sendDigest],
    }),
    sendDigest,
  ])
  .build();
```

Cron options:

- `expression` (required): 5-field cron expression.
- `input`: static input payload used for each run.
- `timezone`: timezone for parser evaluation.
- `immediate`: run once immediately on startup, then continue schedule.
- `enabled`: set to `false` to disable scheduling without removing the tag.
- `onError`: `"continue"` (default) or `"stop"` for that schedule.
- `silent`: suppress all cron log output for this task when `true` (default `false`).

`globals.resources.cron.with({...})` options:

- `only`: optional array of task ids or task definitions; when set, only those cron-tagged tasks are scheduled.

Operational notes:

- One cron tag per task is supported. If you need multiple schedules, fork the task and tag each fork.
- If `globals.resources.cron` is not registered, cron tags are treated as metadata and no schedules are started.
- Scheduler uses `setTimeout` chaining, which keeps it portable across supported runtimes.
- Startup and execution lifecycle messages are emitted via `globals.resources.logger`.
- On `globals.events.disposing`, cron stops all pending schedules immediately (no new timer-driven runs), while already in-flight cron executions drain under the normal shutdown budgets.

Best practices:

- Keep cron task logic idempotent (retries, restarts, and manual reruns happen).
- Use `timezone` explicitly for business schedules to avoid DST surprises.
- Use `onError: "stop"` only when repeated failure should disable the schedule.
- Keep cron tasks thin; delegate heavy logic to regular tasks for reuse/testing.

> **runtime:** "Cron: because 'I'll remember to run it every morning' is how scripts become folklore. I set the timer, you make the task idempotent, and we both sleep better."

---

## Concurrency Utilities

Runner includes two battle-tested primitives for managing concurrent operations:

| Utility       | What it does                 | Use when                           |
| ------------- | ---------------------------- | ---------------------------------- |
| **Semaphore** | Limits concurrent operations | Rate limiting, connection pools    |
| **Queue**     | Serializes operations        | File writes, sequential processing |

Both ship with Runner—no external dependencies.

---

## Semaphore

Imagine this: Your API has a rate limit of 100 requests/second, but 1,000 users are hammering it at once. Without controls, you get 429 errors. Or your database pool has 20 connections, but you're firing off 100 queries simultaneously—they queue up, time out, and crash your app.

**The problem**: You need to limit how many operations run concurrently, but JavaScript's async nature makes it hard to enforce.

**The naive solution**: Use a simple counter and `Promise.all` with manual tracking. But this is error-prone—it's easy to forget to release a permit, leading to deadlocks.

**The better solution**: Use a Semaphore, a concurrency primitive that automatically manages permits.

### When to Use Semaphore

| Use case                   | Why Semaphore helps                        |
| -------------------------- | ------------------------------------------ |
| API rate limiting          | Prevents 429 errors by throttling requests |
| Database connection pools  | Keeps you within pool size limits          |
| Heavy CPU tasks            | Prevents memory/CPU exhaustion             |
| Third-party service limits | Respects external service quotas           |

### Basic usage

```typescript
import { Semaphore } from "@bluelibs/runner";

// Allow max 5 concurrent database queries
const dbSemaphore = new Semaphore(5);

// Preferred: automatic acquire/release
const users = await dbSemaphore.withPermit(async () => {
  return await db.query("SELECT * FROM users");
}); // Permit released automatically, even if query throws
```

**Pro Tip**: You don't always need to use `Semaphore` manually. The `concurrency` middleware (available via `globals.middleware.task.concurrency`) provides a declarative way to apply these limits to your tasks.

### Manual acquire/release

When you need more control:

```typescript
// The elegant approach - automatic cleanup guaranteed!
const users = await dbSemaphore.withPermit(async () => {
  return await db.query("SELECT * FROM users WHERE active = true");
});
```

Prevent operations from hanging indefinitely with configurable timeouts:

```typescript
try {
  // Wait max 5 seconds, then throw timeout error
  await dbSemaphore.acquire({ timeout: 5000 });
  // Your code here
} catch (error) {
  console.log("Operation timed out waiting for permit");
}

// Or with withPermit
const result = await dbSemaphore.withPermit(
  async () => await slowDatabaseOperation(),
  { timeout: 10000 }, // 10 second timeout
);
```

Operations can be cancelled using AbortSignal:

```typescript
const controller = new AbortController();

// Start an operation
const operationPromise = dbSemaphore.withPermit(
  async () => await veryLongOperation(),
  { signal: controller.signal },
);

// Cancel the operation after 3 seconds
setTimeout(() => {
  controller.abort();
}, 3000);

try {
  await operationPromise;
} catch (error) {
  console.log("Operation was cancelled");
}
```

Want to know what's happening under the hood?

```typescript
// Get comprehensive metrics
const metrics = dbSemaphore.getMetrics();
console.log(`
Semaphore Status Report:
  Available permits: ${metrics.availablePermits}/${metrics.maxPermits}
  Operations waiting: ${metrics.waitingCount}
  Utilization: ${(metrics.utilization * 100).toFixed(1)}%
  Disposed: ${metrics.disposed ? "Yes" : "No"}
`);

// Quick checks
console.log(`Available permits: ${dbSemaphore.getAvailablePermits()}`);
console.log(`Queue length: ${dbSemaphore.getWaitingCount()}`);
console.log(`Is disposed: ${dbSemaphore.isDisposed()}`);
```

Properly dispose of semaphores when finished:

```typescript
// Reject all waiting operations and prevent new ones
dbSemaphore.dispose();

// All waiting operations will be rejected with:
// Error: "Semaphore has been disposed"
```

### From Utilities to Middlewares

While `Semaphore` and `Queue` provide powerful manual control, Runner often wraps these into declarative middlewares for common patterns:

- **concurrency**: Uses `Semaphore` internally to limit task parallelization.
- **temporal**: Uses timers and promise-tracking to implement `debounce` and `throttle`.
- **rateLimit**: Uses fixed-window counting to protect resources from bursts.

**What you just learned**: Utilities are the building blocks; Middlewares are the blueprints for common resilience patterns.

> **runtime:** "I provide the bricks and the mortar. You decide if you're building a fortress or just a very complicated way to trip over your own feet. Use the middleware for common paths; use the utilities when you want to play architect."

---

## Queue

Picture this: Two users register at the same time, and your code writes their data simultaneously. The file gets corrupted—half of one user, half of another. Or you run database migrations in parallel and the schema gets into an inconsistent state.

**The problem**: Concurrent operations can corrupt data, produce inconsistent results, or violate business rules that require sequence.

**The naive solution**: Use `await` between operations or a simple array to queue them manually. But this is tedious and error-prone—easy to forget and skip a step.

**The better solution**: Use a Queue, which serializes operations automatically, ensuring they run one-by-one in order.

### When to Use Queue

| Use case             | Why Queue helps                                 |
| -------------------- | ----------------------------------------------- |
| File system writes   | Prevents file corruption from concurrent access |
| Sequential API calls | Maintains request ordering                      |
| Database migrations  | Ensures schema changes apply in order           |
| Audit logs           | Guarantees chronological ordering               |

### Basic usage

```typescript
import { Queue } from "@bluelibs/runner";

const queue = new Queue();

// Tasks run sequentially, even if queued simultaneously
const [result1, result2] = await Promise.all([
  queue.run(async () => await writeFile("a.txt", "first")),
  queue.run(async () => await writeFile("a.txt", "second")),
]);
// File contains "second" - no corruption from concurrent writes
```

### Cancellation support

Each task receives an `AbortSignal` for cooperative cancellation:

```typescript
import { Queue } from "@bluelibs/runner";

const queue = new Queue();

// Queue up some work
const result = await queue.run(async (signal) => {
  // Your async task here
  return "Task completed";
});

// Graceful shutdown
await queue.dispose();
```

### AbortController Integration

The Queue provides each task with an `AbortSignal` for cooperative cancellation. Tasks should periodically check this signal to enable early termination.

### Examples

**Example: Long-running Task**

```typescript
const queue = new Queue();

// Task that respects cancellation
const processLargeDataset = queue.run(async (signal) => {
  const items = await fetchLargeDataset();

  for (const item of items) {
    // Check for cancellation before processing each item
    if (signal.aborted) {
      throw new Error("Operation was cancelled");
    }

    await processItem(item);
  }

  return "Dataset processed successfully";
});

// Cancel all running tasks
await queue.dispose({ cancel: true });
```

**Network Request with Timeout**

```typescript
const queue = new Queue();

const fetchWithCancellation = queue.run(async (signal) => {
  try {
    // Pass the signal to fetch for automatic cancellation
    const response = await fetch("https://api.example.com/data", { signal });
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      console.log("Request was cancelled");
      throw error;
    }
    throw error;
  }
});

// This will cancel the fetch request if still pending
await queue.dispose({ cancel: true });
```

**Example: File Processing with Progress Tracking**

```typescript
const queue = new Queue();

const processFiles = queue.run(async (signal) => {
  const files = await getFileList();
  const results = [];

  for (let i = 0; i < files.length; i++) {
    // Respect cancellation
    signal.throwIfAborted();

    const result = await processFile(files[i]);
    results.push(result);

    // Optional: Report progress
    console.log(`Processed ${i + 1}/${files.length} files`);
  }

  return results;
});
```

#### The Magic Behind the Curtain

- `tail`: The promise chain that maintains FIFO execution order
- `disposed`: Boolean flag indicating whether the queue accepts new tasks
- `abortController`: Centralized cancellation controller that provides `AbortSignal` to all tasks
- `executionContext`: AsyncLocalStorage-based deadlock detection mechanism

#### Implement Cooperative Cancellation

Tasks should regularly check the `AbortSignal` and respond appropriately:

```typescript
// Preferred: Use signal.throwIfAborted() for immediate termination
signal.throwIfAborted();

// Alternative: Check signal.aborted for custom handling
if (signal.aborted) {
  cleanup();
  throw new Error("Operation cancelled");
}
```

**Integrate with Native APIs**

Many Web APIs accept `AbortSignal`:

- `fetch(url, { signal })`
- `setTimeout(callback, delay, { signal })`
- Custom async operations

**Avoid Nested Queuing**

The Queue prevents deadlocks by rejecting attempts to queue tasks from within running tasks. Structure your code to avoid this pattern.

**Handle AbortError Gracefully**

```typescript
try {
  await queue.run(task);
} catch (error) {
  if (error.name === "AbortError") {
    // Expected cancellation, handle appropriately
    return;
  }
  throw error; // Re-throw unexpected errors
}
```

### Lifecycle events (isolated EventManager)

`Queue` also publishes local lifecycle events for lightweight telemetry. Each Queue instance has its own **isolated EventManager**—these events are local to the Queue and are completely separate from the global EventManager used for business-level application events.

- `enqueue` · `start` · `finish` · `error` · `cancel` · `disposed`

```typescript
const q = new Queue();
q.on("start", ({ taskId }) => console.log(`task ${taskId} started`));
await q.run(async () => "ok");
await q.dispose({ cancel: true }); // emits cancel + disposed
```

> **runtime:** "Queue: one line, no cutting, no vibes. Throughput takes a contemplative pause while I prevent you from queuing a queue inside a queue and summoning a small black hole."

---

## Remote Lanes (Node)

Remote Lanes let you split a Runner application across processes or machines without changing your business logic. Two lane systems cover the common distributed patterns:

| Need                             | Lane System                   | Semantics                        |
| -------------------------------- | ----------------------------- | -------------------------------- |
| Fire-and-forget async delivery   | **Event Lanes** (`eventLane`) | Queue-backed produce/consume     |
| Request/response across services | **RPC Lanes** (`rpcLane`)     | Sync remote task/event execution |

Lane behavior is attached at runtime by `eventLanesResource` / `rpcLanesResource`. Definitions that are **not** assigned to a lane keep normal local Runner behavior — lanes are additive, never invasive.

### Event Lane Quick Start

```typescript
import { globals, r, run } from "@bluelibs/runner";
import {
  eventLanesResource,
  MemoryEventLaneQueue,
} from "@bluelibs/runner/node";

// 1. Define a lane — a logical routing channel
const emailLane = r.eventLane("app.lanes.email").build();

// 2. Tag the event for lane routing
const userRegistered = r
  .event<{ userId: string }>("app.events.userRegistered")
  .tags([globals.tags.eventLane.with({ lane: emailLane })])
  .build();

// 3. Hook runs on the consumer side after relay
const sendWelcome = r
  .hook("app.hooks.sendWelcome")
  .on(userRegistered)
  .run(async (event) => {
    console.log("Sending welcome email to", event.data.userId);
  })
  .build();

// 4. Wire topology: who consumes what, and which queue backs each lane
const topology = r.eventLane.topology({
  profiles: {
    api: { consume: [] },
    worker: { consume: [emailLane] },
  },
  bindings: [{ lane: emailLane, queue: new MemoryEventLaneQueue() }],
});

// 5. Register and run
const app = r
  .resource("app")
  .register([
    userRegistered,
    sendWelcome,
    eventLanesResource.with({ profile: "worker", topology, mode: "network" }),
  ])
  .build();
```

### RPC Lane Quick Start

```typescript
import { globals, r } from "@bluelibs/runner";
import { rpcLanesResource } from "@bluelibs/runner/node";

// 1. Define a lane
const billingLane = r.rpcLane("app.rpc.billing").build();

// 2. Tag the task for lane routing
const chargeCard = r
  .task("billing.tasks.chargeCard")
  .tags([globals.tags.rpcLane.with({ lane: billingLane })])
  .run(async (input: { amount: number }) => ({
    ok: true,
    amount: input.amount,
  }))
  .build();

// 3. Create a communicator for the remote side
const billingComm = r
  .resource("app.resources.billingComm")
  .init(
    r.rpcLane.httpClient({
      client: "mixed",
      baseUrl: "http://billing:7070/__runner",
    }),
  )
  .build();

// 4. Wire topology and register
const topology = r.rpcLane.topology({
  profiles: {
    api: { serve: [] },
    billing: { serve: [billingLane] },
  },
  bindings: [{ lane: billingLane, communicator: billingComm }],
});
```

### Local Development Modes

You don't need external infrastructure to develop and test lanes:

- `mode: "transparent"` — bypass transport completely; hooks run locally as if no lane existed. Use for fast unit-test feedback.
- `mode: "local-simulated"` — events cross the serializer boundary (`stringify -> parse`) before local re-emit. Catches non-JSON-safe payload issues.
- Two runtimes in one process + `MemoryEventLaneQueue` — emulate full profile split without external infra.

### Operational Knobs

In `mode: "network"`, Event Lane bindings support `prefetch`, `maxAttempts`, and `retryDelayMs`. RabbitMQ dead-letter ownership is broker/queue-policy based; Runner settles final failures with `nack(false)` and does not manually publish to DLQ.

For complete examples, common patterns, testing strategies, debugging, migration notes, and RabbitMQ configuration, see [REMOTE_LANES.md](../readmes/REMOTE_LANES.md).

> **runtime:** "Serve it or ship it. There is no 'maybe call the other service.'"
