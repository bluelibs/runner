## Caching

Because nobody likes waiting for the same expensive operation twice:

```typescript
import { globals } from "@bluelibs/runner";

const expensiveTask = r
  .task("app.tasks.expensive")
  .middleware([
    globals.middleware.task.cache.with({
      // lru-cache options by default
      ttl: 60 * 1000, // Cache for 1 minute
      keyBuilder: (taskId, input: any) => `${taskId}-${input.userId}`, // optional key builder
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
import { r } from "@bluelibs/runner";

const redisCacheFactory = r
  .task("globals.tasks.cacheFactory") // Same ID as the default task
  .run(async (input: any) => new RedisCache(input))
  .build();

const app = r
  .resource("app")
  .register([globals.resources.cache])
  .overrides([redisCacheFactory]) // Override the default cache factory
  .build();
```

> **runtime:** "'Because nobody likes waiting.' Correct. You keep asking the same question like a parrot with Wi‑Fi, so I built a memory palace. Now you get instant answers until you change one variable and whisper 'cache invalidation' like a curse."

## Performance

BlueLibs Runner is designed with performance in mind. The framework introduces minimal overhead while providing powerful features like dependency injection, middleware, and event handling.

Test it yourself by cloning @bluelibs/runner and running `npm run benchmark`.

You may see negative middlewareOverheadMs. This is a measurement artifact at micro-benchmark scale: JIT warm‑up, CPU scheduling, GC timing, and cache effects can make the "with middleware" run appear slightly faster than the baseline. Interpret small negatives as ≈ 0 overhead.

### Performance Benchmarks

Here are real performance metrics from our comprehensive benchmark suite on an M1 Max.

** Core Operations**

- **Basic task execution**: ~2.2M tasks/sec
- **Task execution with 5 middlewares**: ~244,000 tasks/sec
- **Resource initialization**: ~59,700 resources/sec
- **Event emission and handling**: ~245,861 events/sec
- **Dependency resolution (10-level chain)**: ~8,400 chains/sec

#### Overhead Analysis

- **Middleware overhead**: ~0.0013ms for all 5, ~0.00026ms per middleware (virtually zero)
- **Memory overhead**: ~3.3MB for 100 components (resources + tasks)
- **Cache middleware speedup**: 3.65x faster with cache hits

#### Real-World Performance

```typescript
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
- **Event efficiency**: Event listeners are automatically managed

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

**Bottom line**: The framework adds minimal overhead (~0.005ms per task) while providing significant architectural benefits.

> **runtime:** "'Millions of tasks per second.' Fantastic—on your lava‑warmed laptop, in a vacuum, with the wind at your back. Add I/O, entropy, and one feral user and watch those numbers molt. I’ll still be here, caffeinated and inevitable."

## Retrying Failed Operations

For when things go wrong, but you know they'll probably work if you just try again. The built-in retry middleware makes your tasks and resources more resilient to transient failures.

```typescript
import { globals } from "@bluelibs/runner";

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

> **runtime:** "Retry: the art of politely head‑butting reality. 'Surely it’ll work the fourth time,' you declare, inventing exponential backoff and calling it strategy. I’ll keep the attempts ledger while your API cosplays a coin toss."

## Timeouts

The built-in timeout middleware prevents operations from hanging indefinitely by racing them against a configurable
timeout. Works for resources and tasks.

```typescript
import { globals } from "@bluelibs/runner";

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
