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

- `.subtree({ tasks/resources: { middleware: [...] } })` applies only to the declaring resource subtree
- subtree middleware entries can be conditional with `{ use, when }`
- subtree middleware resolves before local `.middleware([...])`
- local attachment wins when the same middleware id appears both ways

### Subtree Validation

Subtree validation is return-based. The `SubtreeViolation` shape is your own\u2014Runner expects `{ code, message }` objects.

```typescript
import { r, run } from "@bluelibs/runner";

type SubtreeViolation = {
  code: string;
  message: string;
};

const app = r
  .resource("app")
  .subtree({
    tasks: {
      validate: (taskDefinition): SubtreeViolation[] => {
        if (taskDefinition.meta?.title) {
          return [];
        }
        return [
          {
            code: "missing-meta-title",
            message: `Task "${taskDefinition.id}" must define meta.title`,
          },
        ];
      },
    },
  })
  .build();

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

| Middleware     | Config                                    | Notes                                                         |
| -------------- | ----------------------------------------- | ------------------------------------------------------------- |
| cache          | `{ ttl, max, ttlAutopurge, keyBuilder }`  | requires `resources.cache`; Node exposes `redisCacheProvider` |
| concurrency    | `{ limit, key?, semaphore? }`             | limits in-flight executions                                   |
| circuitBreaker | `{ failureThreshold, resetTimeout }`      | opens after failures, then fails fast                         |
| debounce       | `{ ms }`                                  | runs only after inactivity                                    |
| throttle       | `{ ms }`                                  | runs at most once per window                                  |
| fallback       | `{ fallback }`                            | static value, function, or task fallback                      |
| rateLimit      | `{ windowMs, max }`                       | fixed-window admission limit per instance                     |
| retry          | `{ retries, stopRetryIf, delayStrategy }` | transient failures with configurable logic                    |
| timeout        | `{ ttl }`                                 | aborts long-running executions via AbortController            |

Resource equivalents:

- `middleware.resource.retry`
- `middleware.resource.timeout`

Recommended ordering:

- fallback outermost
- timeout inside retry when you want per-attempt budgets
- rate-limit for admission
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

### Global Interception

For true catch-all behavior, use interception APIs during resource init rather than trying to fake it with subtree middleware.

- `taskRunner.intercept(...)` wraps all task executions outermost
- `middlewareManager.intercept("task" | "resource", ...)` wraps middleware composition layers
- `eventManager.intercept(...)` wraps event emission

For context enforcement, use `middleware.task.requireContext.with({ context })` to assert that a specific `IAsyncContext` is present before a task runs. If the context is missing, the task fails immediately with `middlewareContextRequiredError`.

See [Advanced Patterns](./06-advanced.md#advanced-patterns) for interception ordering and runtime-wide interception details.

> **runtime:** "Middleware: the onion pattern, except every layer has opinions and a config object. I peel them in order, cry a little, and hand you the result."
