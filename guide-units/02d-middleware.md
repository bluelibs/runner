## Middleware

Middleware wraps tasks and resources so cross-cutting behavior stays explicit and reusable instead of leaking into business logic.

```typescript
import { r } from "@bluelibs/runner";

type AuthConfig = { requiredRole: string };

const authMiddleware = r.middleware
  .task("authMiddleware")
  .run(async ({ task, next }, _deps, config: AuthConfig) => {
    return await next(task.input);
  })
  .build();

const adminTask = r
  .task("adminTask")
  .middleware([authMiddleware.with({ requiredRole: "admin" })])
  .run(async () => "Secret admin data")
  .build();

// Tasks (and resources) must be registered in a resource before the runtime can use them.
// Inline middleware definitions do not need to be registered separately.
const app = r.resource("app").register([adminTask]).build();
```

**What you just learned**: Middleware wraps tasks or resources with reusable, configurable behavior. Attach it with `.middleware([...])` and configure with `.with()`.

Key rules that keep the middleware model predictable:

- create task middleware with `r.middleware.task(id)`
- create resource middleware with `r.middleware.resource(id)`
- attach middleware with `.middleware([...])`
- first listed middleware is the outermost wrapper
- task middleware can attach only to tasks or `subtree.tasks.middleware`
- resource middleware can attach only to resources or `subtree.resources.middleware`

### Task and Resource Middleware

The two middleware channels serve different wrapping targets:

- task middleware wraps task execution and receives `{ task, next, journal }`
- resource middleware wraps resource initialization or resource value resolution and receives `{ resource, next }`
- task middleware is where auth, retry, cache, timeout, tracing, and admission policies usually live
- resource middleware is where retry or timeout around startup/resource creation usually lives

### Cross-Cutting Middleware

Attach middleware at the owning resource when you want subtree-wide behavior.

```typescript
import { resources, r } from "@bluelibs/runner";

const logTaskMiddleware = r.middleware
  .task("logTaskMiddleware")
  .dependencies({ logger: resources.logger })
  .run(async ({ task, next }, { logger }) => {
    await logger.info(`Executing: ${String(task.definition.id)}`);
    const result = await next(task.input);
    await logger.info(`Completed: ${String(task.definition.id)}`);
    return result;
  })
  .build();

const app = r
  .resource("app")
  .register([logTaskMiddleware])
  .subtree({
    tasks: {
      middleware: [logTaskMiddleware],
    },
  })
  .build();
```

Subtree rules:

Subtree validation is return-based. You can import `SubtreeViolation` from Runner, or return the same `{ code, message }` shape inline.

- subtree middleware entries can be conditional with `{ use, when }`
- subtree middleware resolves before local `.middleware([...])`
- if subtree and local middleware resolve to the same middleware id, Runner fails fast instead of letting the local middleware override the subtree one

```typescript
import { isTask, r, run } from "@bluelibs/runner";
import type { SubtreeViolation } from "@bluelibs/runner";

const app = r
  .resource("app")
  .subtree({
    validate: (definition): SubtreeViolation[] => {
      if (!isTask(definition) || definition.meta?.title) {
        return [];
      }

      return [
        {
          code: "missing-meta-title",
          message: `Task "${definition.id}" must define meta.title`,
        },
      ];
    },
  })
  .build();

await run(app);
```

Rules:

- use exported type guards inside `subtree.validate(...)` when the policy only targets tasks, resources, events, hooks, tags, or middleware
- return `SubtreeViolation[]` for expected policy failures
- do not throw for normal validation failures
- invalid validator returns are aggregated into one subtree validation error

### Middleware Type Contracts

Middleware can enforce input and output contracts on the tasks that use it. This is useful for:

- **Authentication**: ensure all tasks using auth-middleware have `userId` in input
- **API standardization**: enforce consistent response shapes across task groups
- **Validation**: guarantee tasks return required fields

```typescript
import { r } from "@bluelibs/runner";

type AuthConfig = { requiredRole: string };
type AuthInput = { user: { role: string } };
type AuthOutput = { executedBy: { role: string; verified: boolean } };

const authMiddleware = r.middleware
  .task<AuthConfig, AuthInput, AuthOutput>("authMiddleware")
  .run(async ({ task, next }, _deps, config) => {
    const input = task.input;
    if (input.user.role !== config.requiredRole) {
      throw new Error("Insufficient permissions");
    }

    const output = await next(input);
    return {
      ...output,
      executedBy: {
        ...output.executedBy,
        verified: true,
      },
    };
  })
  .build();
```

If you use multiple contract middleware, their contracts combine.

### Built-In Resilience Middleware

Runner ships with built-in middleware for common reliability concerns:

| Middleware     | Config                                    | Notes                                                                    |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| cache          | `{ ttl, max, ttlAutopurge, keyBuilder }`  | backed by `resources.cache`; customize with `resources.cache.with(...)`  |
| concurrency    | `{ limit, key?, semaphore? }`             | limits in-flight executions                                              |
| circuitBreaker | `{ failureThreshold, resetTimeout }`      | opens after failures, then fails fast                                    |
| debounce       | `{ ms, keyBuilder? }`                     | waits for inactivity, then runs once with the latest input for that key  |
| throttle       | `{ ms, keyBuilder? }`                     | runs immediately, then suppresses burst calls until the window ends      |
| fallback       | `{ fallback }`                            | static value, function, or task fallback                                 |
| rateLimit      | `{ windowMs, max, keyBuilder? }`          | fixed-window admission limit per key, for cases like "50 per second"     |
| retry          | `{ retries, stopRetryIf, delayStrategy }` | transient failures with configurable logic                               |
| timeout        | `{ ttl }`                                 | rejects after the deadline and aborts cooperative work via `AbortSignal` |

Resource equivalents:

- `middleware.resource.retry`
- `middleware.resource.timeout`

Recommended ordering:

- fallback outermost
- timeout inside retry when you want per-attempt budgets
- rate-limit for admission control such as "max 50 calls per second"
- concurrency for in-flight control
- cache for idempotent reads

### Policy Examples Worth Keeping

Use timeout and retry when the dangerous failure mode is a task that hangs or a collaborator that fails transiently:

```typescript
import { middleware, r } from "@bluelibs/runner";

// Assuming `unreliableOperation` is your own collaborator.
const robustTask = r
  .task("robustTask")
  .middleware([
    middleware.task.retry.with({ retries: 3 }),
    middleware.task.timeout.with({ ttl: 10_000 }),
  ])
  .run(async () => await unreliableOperation())
  .build();
```

Use cache when the same deterministic request repeats often enough to justify memoization:

```typescript
import { middleware, r } from "@bluelibs/runner";

// Assuming `db` is a resource defined elsewhere.
const getUser = r
  .task<{ id: string }>("getUser")
  .dependencies({ db })
  .middleware([
    middleware.task.cache.with({
      ttl: 60_000,
      keyBuilder: (_taskId, input) => `user:${input.id}`,
    }),
  ])
  .run(async (input, { db }) => {
    return await db.users.findOne({ id: input.id });
  })
  .build();
```

> **Note:** `throttle` and `debounce` shape bursty traffic, but they do not express quotas like "50 calls per second". Use `rateLimit` for that kind of policy.

> **Note:** `rateLimit`, `debounce`, and `throttle` all default to partitioning by `taskId`. Provide `keyBuilder(taskId, input)` when you want per-user, per-tenant, or per-IP behavior. If that key lives in an async context, call `YourContext.use()` directly inside `keyBuilder`.

> **Note:** When tenant-aware middleware runs with `tenantScope`, Runner prefixes the final internal key as `<tenantId>:<baseKey>`. For example, a `keyBuilder` result of `search:ada` becomes `acme:search:ada` when the active tenant value is `acme`. The default behavior is `"auto"`: use the tenant prefix when tenant context exists, otherwise keep the shared key. Use `"required"` when tenant context must exist, and `"off"` only for intentional cross-tenant sharing.

### Resilience Orchestration

In production, one resilience strategy is rarely enough. Runner allows you to compose multiple middleware layers into a "resilience onion" that protects your business logic from multiple failure modes.

A task that calls a remote API might fail due to network blips (needs **Retry**), hang indefinitely (needs **Timeout**), slam the API during traffic spikes (needs **Rate Limit**), or keep failing if the API is down (needs **Circuit Breaker**).

Combine them in the correct order. Like an onion, the outer layers handle broader concerns, while inner layers handle specific execution details.

```typescript
import { r } from "@bluelibs/runner";

const resilientTask = r
  .task("app.tasks.ultimateResilience")
  .middleware([
    // Outer layer: Fallback (the absolute Plan B if everything below fails)
    middleware.task.fallback.with({
      fallback: { status: "offline-mode", data: [] },
    }),

    // Next: Rate Limit (check this before wasting resources or retry budget)
    middleware.task.rateLimit.with({ windowMs: 60000, max: 100 }),

    // Next: Circuit Breaker (stop immediately if the service is known to be down)
    middleware.task.circuitBreaker.with({ failureThreshold: 5 }),

    // Next: Retry (wrap the attempt in a retry loop)
    middleware.task.retry.with({ retries: 3 }),

    // Inner layer: Timeout (enforce limit on EACH individual attempt)
    middleware.task.timeout.with({ ttl: 5000 }),
  ])
  .run(async () => {
    return await fetchDataFromUnreliableSource();
  })
  .build();
```

Best practices for orchestration:

1. **Rate Limit first**: Don't even try to execute or retry if you've exceeded your quota.
2. **Circuit Breaker second**: Don't retry against a service that is known to be failing.
3. **Retry wraps Timeout**: Ensure the timeout applies to the _individual_ attempt, so the retry logic can kick in when one attempt hangs.
4. **Fallback last**: The fallback should be the very last thing that happens if the entire resilience stack fails.

> **runtime:** "Resilience Orchestration: layering defense-in-depth like a paranoid onion. I'm counting your turns, checking the circuit, spinning the retry wheel, and holding a stopwatch—all so you can sleep through a minor server fire."

### Middleware Interception

Use interception when behavior must wrap the middleware composition layer globally or target a single middleware across all its uses.

Available APIs:

- Task middleware layer: `middlewareManager.intercept("task", (next, input) => Promise<any>)`
- Resource middleware layer: `middlewareManager.intercept("resource", (next, input) => Promise<any>)`
- Per-middleware: `middlewareManager.interceptMiddleware(middleware, interceptor)`

Register interceptors during resource `init` before the runtime locks.

`middlewareManager.intercept(...)` wraps every middleware execution on the targeted channel:

```typescript
import { r, resources } from "@bluelibs/runner";

const observabilityInstaller = r
  .resource("app.observability")
  .dependencies({
    middlewareManager: resources.middlewareManager,
    logger: resources.logger,
  })
  .init(async (_config, { middlewareManager, logger }) => {
    middlewareManager.intercept("task", async (next, input) => {
      await logger.info(
        `Middleware entering: ${String(input.task.definition.id)}`,
      );
      const result = await next(input);
      await logger.info(
        `Middleware exiting: ${String(input.task.definition.id)}`,
      );
      return result;
    });
  })
  .build();
```

`interceptMiddleware` targets a single middleware wherever it is applied:

```typescript
middlewareManager.interceptMiddleware(authMiddleware, async (next, input) => {
  // runs every time authMiddleware executes, regardless of which task uses it
  return next(input);
});
```

For context enforcement, use `middleware.task.requireContext.with({ context })` to assert that a specific `IAsyncContext` is present before a task runs. If the context is missing, the task fails immediately with `middlewareContextRequiredError`.

> **runtime:** "Middleware: the onion pattern, except every layer has opinions and a config object. I peel them in order, cry a little, and hand you the result."
