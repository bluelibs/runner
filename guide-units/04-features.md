## Caching

Avoid recomputing expensive work by caching task results with TTL-based eviction:

```typescript
import { r, globals } from "@bluelibs/runner";

const expensiveTask = r
  .task("app.tasks.expensive")
  .middleware([
    globals.middleware.task.cache.with({
      // lru-cache options by default
      ttl: 60 * 1000, // Cache for 1 minute
      keyBuilder: (taskId, input: { userId: string }) => `${taskId}-${input.userId}`, // optional key builder
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

Want Redis instead of the default LRU cache? No problem, just override the cache factory task:

```typescript
import { r, globals } from "@bluelibs/runner";

const redisCacheFactory = r
  .task("globals.tasks.cacheFactory") // Same ID as the default task
  .run(async (input: unknown) => new RedisCache(input))
  .build();

const app = r
  .resource("app")
  .register([globals.resources.cache])
  .overrides([redisCacheFactory]) // Override the default cache factory
  .build();
```

**Journal Introspection**: On cache hits the task `run()` isn't executed, but you can still detect cache hits from a wrapping middleware:

```typescript
import { r, globals } from "@bluelibs/runner";

const cacheJournalKeys = globals.middleware.task.cache.journalKeys;

const cacheLogger = r
  .middleware.task("app.middleware.cacheLogger")
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
const dbLimit = globals.middleware.task.concurrency.with({ semaphore: dbSemaphore });

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
      failureThreshold: 5,   // Trip after 5 failures
      resetTimeout: 30000,  // Stay open for 30 seconds
    })
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
      }
    })
  ])
  .run(async () => {
    return await fetchPriceFromAPI();
  })
  .build();
```

**Journal Introspection**: The original task that throws won't continue execution, but you can detect fallback activation from a wrapping middleware:

```typescript
import { r, globals } from "@bluelibs/runner";

const fallbackJournalKeys = globals.middleware.task.fallback.journalKeys;

const fallbackLogger = r
  .middleware.task("app.middleware.fallbackLogger")
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
      max: 5,              // Max 5 attempts per window
    })
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

**Journal Introspection**: When the task runs (request allowed), you can read the rate limit state from the execution journal:

```typescript
import { r, globals } from "@bluelibs/runner";

const rateLimitJournalKeys = globals.middleware.task.rateLimit.journalKeys;

const myTask = r
  .task("app.tasks.rateLimited")
  .middleware([globals.middleware.task.rateLimit.with({ windowMs: 60000, max: 10 })])
  .run(async (_input, _deps, context) => {
    const remaining = context?.journal.get(rateLimitJournalKeys.remaining); // number
    const resetTime = context?.journal.get(rateLimitJournalKeys.resetTime); // timestamp (ms)
    const limit = context?.journal.get(rateLimitJournalKeys.limit); // number
    console.log(`${remaining}/${limit} requests remaining, resets at ${new Date(resetTime)}`);
    return "result";
  })
  .build();
```

> **runtime:** "Rate limiting: counting beans so you don't have to. You've had five turns this minute; come back when the clock says so."

---

## Performance

Runner keeps the DI and middleware stack lightweight. The numbers below come from the project's benchmark suite; rerun them on your hardware to size real-world overhead.

Test it yourself by cloning @bluelibs/runner and running `npm run benchmark`.

You may see negative middlewareOverheadMs. This is a measurement artifact at micro-benchmark scale: JIT warm‑up, CPU scheduling, GC timing, and cache effects can make the "with middleware" run appear slightly faster than the baseline. Interpret small negatives as ≈ 0 overhead.

### Performance Benchmarks

Here are real performance metrics from our comprehensive benchmark suite on an M1 Max.

**Core Operations**

┌───────────────────────────────────────┬────────────────────────┐
│ Operation                             │ Throughput             │
├───────────────────────────────────────┼────────────────────────┤
│ Basic task execution                  │ ~2.2M tasks/sec        │
│ Task execution with 5 middlewares     │ ~244,000 tasks/sec     │
│ Resource initialization               │ ~59,700 resources/sec  │
│ Event emission and handling           │ ~245,861 events/sec    │
│ Dependency resolution (10-level chain)│ ~8,400 chains/sec      │
└───────────────────────────────────────┴────────────────────────┘

#### Overhead Analysis

- **Middleware overhead**: ~0.0013ms for all 5, ~0.00026ms per middleware (virtually zero)
- **Memory overhead**: ~3.3MB for 100 components (resources + tasks)
- **Cache middleware speedup**: 3.65x faster with cache hits

#### Real-World Performance

```typescript
import { r } from "@bluelibs/runner";

// Assuming: auth, logging, metrics middleware and database are defined elsewhere
// This executes in ~0.005ms on average
const userTask = r
  .task("user.create")
  .middleware([auth, logging, metrics])
  .run(async (input) => database.users.create(input))
  .build();

// 1000 executions = ~5ms total time
for (let i = 0; i < 1000; i++) {
  await userTask(mockUserData);
}
```

### Performance Guidelines

#### When Performance Matters Most

**Use tasks for:**

- High-level business operations that benefit from observability
- Operations that need middleware (auth, caching, retry)
- Functions called from multiple places

**Use regular functions or service resources for:**

- Simple utilities and helpers
- Performance-critical hot paths (< 1ms requirement)
- Single-use internal logic

#### Optimizing Your App

**Middleware Ordering**: Place faster middleware first

```typescript
import { r } from "@bluelibs/runner";

const task = r
  .task("app.performance.example")
  .middleware([
    fastAuthCheck, // ~0.1ms
    slowRateLimiting, // ~2ms
    expensiveLogging, // ~5ms
  ])
  .run(async () => null)
  .build();
```

**Resource Reuse**: Resources are singletons—perfect for expensive setup

```typescript
import { r } from "@bluelibs/runner";

const database = r
  .resource("app.performance.db")
  .init(async () => {
    // Expensive connection setup happens once
    const connection = await createDbConnection();
    return connection;
  })
  .build();
```

**Cache Strategically**: Use built-in caching for expensive operations

```typescript
import { r, globals } from "@bluelibs/runner";

const expensiveTask = r
  .task("app.performance.expensive")
  .middleware([globals.middleware.task.cache.with({ ttl: 60000 })])
  .run(async (input) => {
    // This expensive computation is cached
    return performExpensiveCalculation(input);
  })
  .build();
```

#### Memory Considerations

- **Lightweight**: Each component adds ~33KB to memory footprint
- **Automatic cleanup**: Resources dispose properly to prevent leaks
- **Event efficiency**: Hook subscriptions are automatically managed

#### Benchmarking Your Code

Run the framework's benchmark suite:

```bash
# Comprehensive benchmarks
npm run test -- --testMatch="**/comprehensive-benchmark.test.ts"

# Benchmark.js based tests
npm run benchmark
```

Create your own performance tests:

```typescript
const iterations = 1000;
const start = performance.now();

for (let i = 0; i < iterations; i++) {
  await yourTask(testData);
}

const duration = performance.now() - start;
console.log(`${iterations} tasks in ${duration.toFixed(2)}ms`);
console.log(`Average: ${(duration / iterations).toFixed(4)}ms per task`);
console.log(
  `Throughput: ${Math.round(iterations / (duration / 1000))} tasks/sec`,
);
```

### Performance vs Features Trade-off

BlueLibs Runner achieves high performance while providing enterprise features:

| Feature              | Overhead             | Benefit                       |
| -------------------- | -------------------- | ----------------------------- |
| Dependency Injection | ~0.001ms             | Type safety, testability      |
| Event System         | ~0.013ms             | Loose coupling, observability |
| Middleware Chain     | ~0.0003ms/middleware | Cross-cutting concerns        |
| Resource Management  | One-time init        | Singleton pattern, lifecycle  |
| Built-in Caching     | Variable speedup     | Automatic optimization        |

**Bottom line**: On the measured hardware, the overhead for a task pipeline stayed around ~0.005ms while still enabling DI, middleware, and events. Validate against your own workload to set budgets.

> **runtime:** "'Millions of tasks per second.' Fantastic—on your lava‑warmed laptop, in a vacuum, with the wind at your back. Add I/O, entropy, and one feral user and watch those numbers molt. I’ll still be here, caffeinated and inevitable."

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
    if ((attempt ?? 0) > 0) console.log(`Retry attempt ${attempt} after: ${lastError?.message}`);
    return "result";
  })
  .build();
```

> **runtime:** "Retry: the art of politely head‑butting reality. 'Surely it’ll work the fourth time,' you declare, inventing exponential backoff and calling it strategy. I’ll keep the attempts ledger while your API cosplays a coin toss."

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

> **runtime:** "Timeouts: you tie a kitchen timer to my ankle and yell 'hustle.' When the bell rings, you throw a `TimeoutError` like a penalty flag. It’s not me, it’s your molasses‑flavored endpoint. I just blow the whistle."
## Concurrency Utilities

Runner includes two battle-tested primitives for managing concurrent operations:

| Utility       | What it does                 | Use when                           |
| ------------- | ---------------------------- | ---------------------------------- |
| **Semaphore** | Limits concurrent operations | Rate limiting, connection pools    |
| **Queue**     | Serializes operations        | File writes, sequential processing |

Both ship with Runner—no external dependencies.

---

## Semaphore

Limit how many operations can run at once. Perfect for:

- Database connection pools (don't exceed pool size)
- API rate limits (max 10 requests/second)
- Resource-intensive tasks (limit CPU/memory pressure)

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

Run operations one at a time, in order. Perfect for:

- File system writes (prevent corruption)
- Sequential API calls (maintain order)
- Database migrations (one at a time)

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
