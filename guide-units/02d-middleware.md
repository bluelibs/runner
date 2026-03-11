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
  import { isTask, r, run } from "@bluelibs/runner";
  import type { SubtreeViolation } from "@bluelibs/runner";

```typescript
import { r, run } from "@bluelibs/runner";

type SubtreeViolation = {
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
          {
            code: "missing-meta-title",
            message: `Task "${taskDefinition.id}" must define meta.title`,
          },
        ];
      },
    },
  })
  .build();
- use exported type guards inside `subtree.validate(...)` when the policy only targets tasks, resources, events, hooks, tags, or middleware

await run(app);
```

Rules:

- return `SubtreeViolation[]` for expected policy failures
- do not throw for normal validation failures
- invalid validator returns are aggregated into one subtree validation error

### Middleware Type Contracts

Middleware can enforce input and output contracts on the tasks that use it.

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

| Middleware     | Config                                    | Notes                                                                     |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| cache          | `{ ttl, max, ttlAutopurge, keyBuilder }`  | backed by `resources.cache`; customize with `resources.cache.with(...)`   |
| concurrency    | `{ limit, key?, semaphore? }`             | limits in-flight executions                                               |
| circuitBreaker | `{ failureThreshold, resetTimeout }`      | opens after failures, then fails fast                                     |
| debounce       | `{ ms, keyBuilder? }`                     | waits for inactivity, then runs once with the latest input for that key   |
| throttle       | `{ ms, keyBuilder? }`                     | runs immediately, then suppresses burst calls until the window ends       |
| fallback       | `{ fallback }`                            | static value, function, or task fallback                                  |
| rateLimit      | `{ windowMs, max, keyBuilder? }`          | fixed-window admission limit per key, for cases like "50 per second"      |
| retry          | `{ retries, stopRetryIf, delayStrategy }` | transient failures with configurable logic                                |
| timeout        | `{ ttl }`                                 | rejects after the deadline and aborts cooperative work via `AbortSignal`  |

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

### Global Interception

For true catch-all behavior, use interception APIs during resource init rather than trying to fake it with subtree middleware.

- `taskRunner.intercept(...)` wraps all task executions outermost
- `middlewareManager.intercept("task" | "resource", ...)` wraps middleware composition layers
- `eventManager.intercept(...)` wraps event emission

For context enforcement, use `middleware.task.requireContext.with({ context })` to assert that a specific `IAsyncContext` is present before a task runs. If the context is missing, the task fails immediately with `middlewareContextRequiredError`.

See [Advanced Patterns](./06-advanced.md#advanced-patterns) for interception ordering and runtime-wide interception details.

> **runtime:** "Middleware: the onion pattern, except every layer has opinions and a config object. I peel them in order, cry a little, and hand you the result."
