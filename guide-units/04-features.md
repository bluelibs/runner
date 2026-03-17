## HTTP Server Shutdown Pattern (`cooldown` + `dispose`)

For HTTP servers, split shutdown work into two phases:

- `cooldown()`: stop new intake immediately.
- `dispose()`: finish teardown after Runner (task/event) drain and lifecycle hooks complete.

> **Platform Note:** The HTTP examples in this section use Express and Node's HTTP server APIs, so they run on Node.js.

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
  .resource<{ port: number }>("httpServer")
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

- `cooldown()` runs before `events.disposing` and before drain wait, so it prevents new HTTP requests from entering.
- In-flight requests/tasks/events still get the normal drain window (`dispose.drainingBudgetMs`).
- `dispose()` runs after drain, so cleanup can focus on leftovers only.
- This is the intended `cooldown()` shape: ingress resources that route to tasks/events.
- Infrastructure dependencies (database connections, cache clients, brokers) should usually skip `cooldown()` and only clean up in `dispose()`, so in-flight work can still finish during drain.

`cooldown()` can be async, but keep it short. Trigger intake stop and return quickly; let Runner's drain phase do the waiting.

When you also want an operator-facing summary, pair ingress readiness with resource-level health probes:

```typescript
const report = await health.getHealth();
// {
//   totals: { resources: 3, healthy: 2, degraded: 1, unhealthy: 0 },
//   report: [...]
// }

const dbStatus = report.find(db).status;
```

Only resources that explicitly define `health()` participate. This keeps health reporting intentional instead of synthesizing fake status for every resource in the graph. Lazy resources that are still sleeping are skipped. Prefer `resources.health` inside resources; keep `runtime.getHealth()` for operator-facing runtime access.

Tasks can also declare a fail-fast policy around critical resources:

```typescript
const writeOrder = r
  .task("writeOrder")
  .tags([tags.failWhenUnhealthy.with([db])])
  .run(async (input) => persistOrder(input))
  .build();
```

When `db.health()` reports `unhealthy`, Runner blocks the task before its logic runs. `degraded` still executes, bootstrap-time task calls are not gated, and sleeping lazy resources remain skipped until they wake up.

For lightweight lifecycle-owned polling or recovery loops, use `resources.timers`:

```typescript
const app = r
  .resource("app")
  .dependencies({ timers: resources.timers, health: resources.health })
  .ready(async (_value, _config, { timers, health }) => {
    const interval = timers.setInterval(async () => {
      const report = await health.getHealth([db]);
      if (report.report[0]?.status === "healthy") {
        interval.cancel();
      }
    }, 1000);
  })
  .build();
```

`resources.timers` is available during `init()` as well. Once the timers resource enters `cooldown()`, it stops accepting new timers, and its `dispose()` clears anything still pending.

---

## Execution Context and Signal Propagation

Execution context has two jobs:

- expose runtime execution metadata such as `correlationId`
- carry the ambient execution `signal` through nested task and event dependency calls

This is a runtime surface, not a business-state async context. Use `r.asyncContext(...)` for tenant, auth, locale, or request metadata you own. Use `asyncContexts.execution` when you want Runner's execution metadata and signal propagation.

That second job matters now because signal propagation has two layers:

- explicit call-site signal: `runTask(task, input, { signal })` or `emit(payload, { signal })`
- ambient execution signal: when execution context is enabled, nested dependency calls can inherit the first signal already attached to the current execution tree

Think of the explicit signal as the boundary input and execution context as the propagation mechanism.

### Full vs Lightweight Mode

Use full mode when you need tracing and cycle protection:

```typescript
const runtime = await run(app, {
  executionContext: true,
});
```

Use lightweight mode when you mainly want cheap signal inheritance and correlation ids:

```typescript
const runtime = await run(app, {
  executionContext: { frames: "off", cycleDetection: false },
});
```

Snapshot behavior:

- both modes expose `correlationId`, `startedAt`, `signal`, and `framesMode`
- `framesMode: "full"` also exposes `depth`, `currentFrame`, and `frames`
- `framesMode: "off"` skips frame-stack bookkeeping entirely

Use lightweight mode when you want the signal propagation and correlation benefits without paying for execution-tree tracing on every task or event.

### How Signal Propagation Works

Runner keeps the model intentionally simple:

- the first signal seen in the execution tree becomes the ambient execution signal
- omitted nested task/event dependency calls inherit that ambient signal
- an explicit nested `signal` applies only to that direct child call or emission subtree
- explicit nested signals do not replace the already-inherited ambient execution signal
- if no real signal exists, `context.signal` and `event.signal` stay `undefined`

This keeps cancellation cheap for normal flows and predictable for nested orchestration.

### Minimal HTTP Boundary Example

This is the smallest useful pattern for request-scoped cancellation:

```typescript
import express from "express";
import type { Server } from "node:http";
import { r, run } from "@bluelibs/runner";

const getProfile = r
  .task("getProfile")
  .run(async ({ userId }, _deps, context) => {
    const response = await fetch(`https://api.example.com/users/${userId}`, {
      signal: context.signal,
    });

    return response.json();
  })
  .build();

const httpServer = r
  .resource<{ port: number }>("httpServer")
  .context(() => ({ listener: null as Server | null }))
  .dependencies({ getProfile })
  .ready(async (_value, { port }, { getProfile }, context) => {
    const app = express();

    app.get("/profile/:userId", async (req, res) => {
      const controller = new AbortController();
      req.on("close", () => controller.abort("Client disconnected"));

      try {
        const profile = await getProfile(
          { userId: req.params.userId },
          { signal: controller.signal },
        );

        res.json(profile);
      } catch (error) {
        res.status(499).json({ error: String(error) });
      }
    });

    context.listener = app.listen(port);
  })
  .dispose(async (_value, _config, _deps, context) => {
    await new Promise<void>((resolve) => context.listener?.close(() => resolve()));
  })
  .build();

const appResource = r
  .resource("app")
  .register([getProfile, httpServer.with({ port: 3000 })])
  .build();

await run(appResource, {
  executionContext: { frames: "off", cycleDetection: false },
});
```

Why this works:

- the Express resource is the ingress boundary
- the request creates one `AbortController` and passes its `signal` into the injected task call
- `getProfile` sees that signal as `context.signal`
- if no boundary signal is passed, `context.signal` stays `undefined`

This is the common shape for routers, RPC handlers, queue consumers, and other ingress points: inject the boundary signal once, then let execution context carry it through the execution tree.

### `provide()` and `record()`

Use `provide()` when the external boundary already has execution metadata you want Runner to reuse:

```typescript
import { asyncContexts } from "@bluelibs/runner";

await asyncContexts.execution.provide(
  {
    correlationId: req.headers["x-request-id"] as string,
    signal: controller.signal,
  },
  () => runtime.runTask(handleRequest, input),
);
```

Use `record()` when you want the full execution tree back for tests or debugging:

```typescript
import { asyncContexts } from "@bluelibs/runner";

const { result, recording } = await asyncContexts.execution.record(() =>
  runtime.runTask(handleRequest, input, { signal: controller.signal }),
);
```

If the runtime uses lightweight mode, `record()` temporarily promotes the callback to full frame tracking.

`provide()` and `record()` do not create cancellation on their own. They only seed an existing signal into the execution tree when you already have one at the boundary.

### Cycle Protection

Cycle protection still comes in layers:

- declared `.dependencies(...)` cycles fail during bootstrap graph validation
- declared hook-driven event bounce graphs fail during bootstrap event-emission validation
- dynamic runtime loops such as `task -> event -> hook -> task` need full execution context with cycle detection enabled

Lightweight mode is for propagation, not runtime loop detection.

---

## Async Context For Business State

Use `r.asyncContext(...)` when you need request-local business state such as tenant identity, auth claims, locale, or request ids.

Unlike `asyncContexts.execution`, this is your application contract. You define the value shape, decide whether it is required, and optionally define how it crosses transport boundaries. Inside one async execution tree, the active value also stays visible to nested `run()` work, so a tenant or request context can flow into a nested runtime when you intentionally compose things that way.

### Smallest Useful Pattern

```typescript
import { Match, r, run } from "@bluelibs/runner";

const requestContext = r
  .asyncContext("requestContext")
  .schema({
    requestId: Match.NonEmptyString,
    tenantId: Match.NonEmptyString,
    locale: Match.Optional(String),
  })
  .build();

const listProjects = r
  .task("listProjects")
  .dependencies({ requestContext })
  .middleware([requestContext.require()])
  .run(async (_input, { requestContext }) => {
    const request = requestContext.use();

    return {
      tenantId: request.tenantId,
      requestId: request.requestId,
      locale: request.locale ?? "en",
    };
  })
  .build();

const app = r
  .resource("app")
  .register([requestContext, listProjects])
  .build();

const runtime = await run(app);

await requestContext.provide(
  {
    requestId: "req_123",
    tenantId: "acme",
    locale: "en",
  },
  () => runtime.runTask(listProjects),
);
```

Why this pattern works:

- `provide(value, fn)` binds the value to the current async execution tree before `fn` runs.
- nested `run()` calls created inside that same async execution tree inherit the active value too, which is rare but useful for tenant-aware orchestration.
- `.schema(...)` validates the value when you call `provide(...)`, so bad ingress data fails fast.
- registering the context makes it injectable through `.dependencies({ requestContext })`.
- `requestContext.require()` is a shorthand for `middleware.task.requireContext.with({ context: requestContext })`.

### Access Patterns

Pick the accessor that matches how strict the call site should be:

- `use()`: read the value and throw immediately when it is missing.
- `tryUse()`: read the value when present, otherwise return `undefined`.
- `has()`: check whether the context is active.
- `require()`: turn missing context into middleware-level failure before task logic starts.
- `optional()`: inject the context as an optional dependency in apps where registration is conditional.

```typescript
const maybeAudit = r
  .task("maybeAudit")
  .dependencies({ requestContext: requestContext.optional() })
  .run(async (_input, { requestContext }) => {
    return requestContext?.tryUse()?.requestId;
  })
  .build();
```

Use `use()` or `require()` when continuing without context would be a correctness bug. Use `tryUse()` or `has()` in shared helpers, optional integrations, or platform-neutral code paths.

### Transport and Serialization

By default, async contexts use Runner's serializer. That is enough for in-process flows and many transport cases.

Add custom `serialize(...)` and `parse(...)` only when you need a specific wire format for HTTP or remote-lane boundaries:

```typescript
import { Match, Serializer, createHttpClient, r } from "@bluelibs/runner";

const requestContextShape = Match.Object({
  requestId: Match.NonEmptyString,
  tenantId: Match.NonEmptyString,
});

const requestContext = r
  .asyncContext("requestContext")
  .schema(requestContextShape)
  .serialize((value) => JSON.stringify(value))
  .parse((raw) => requestContextShape.parse(JSON.parse(raw)))
  .build();

const client = createHttpClient({
  baseUrl: "https://api.example.com",
  serializer: new Serializer(),
  contexts: [requestContext],
});

await requestContext.provide(
  { requestId: "req_42", tenantId: "acme" },
  () => client.task("listProjects"),
);
```

Transport rules:

- define `.schema(...)` before custom `.serialize(...)` or `.parse(...)` so the builder can keep the resolved value type aligned.
- `createHttpClient({ contexts: [...] })` snapshots only the contexts you list.
- remote lanes hydrate only registered contexts that are also allowlisted with `eventLane.asyncContexts([...])` or `rpcLane.asyncContexts([...])`.
- custom serialization is about transport compatibility, not normal in-process access.

> **Platform Note:** User-defined async contexts require `AsyncLocalStorage`. They work on the Node build and on compatible Bun/Deno universal runtimes that expose async-local storage. In browsers and other runtimes without it, `use()`, `tryUse()`, and `provide()` are not available for user-defined `r.asyncContext(...)` contracts.

For Runner's tenant-aware framework behavior, prefer the pattern in [`04c-multi-tenant`](./04c-multi-tenant.md): use the built-in `asyncContexts.identity` when `{ tenantId }` is enough, or pass your own registered `r.asyncContext(...).configSchema(...)` to `run(..., { identity })` when you need a richer contract.

---

## Cron Scheduling

Need recurring task execution without bringing in a separate scheduler process? Runner ships with a built-in global cron scheduler.

You mark tasks with `tags.cron.with({...})` (alias: `resources.cron.tag.with({...})`), and `resources.cron` discovers and schedules them at startup. The cron resource is opt-in, so you must register it explicitly.

```typescript
import { r } from "@bluelibs/runner";

const sendDigest = r
  .task("sendDigest")
  .tags([
    tags.cron.with({
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
    resources.cron.with({
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

`resources.cron.with({...})` options:

- `only`: optional array of task ids or task definitions; when set, only those cron-tagged tasks are scheduled.

Operational notes:

- One cron tag per task is supported. If you need multiple schedules, fork the task and tag each fork.
- If `resources.cron` is not registered, cron tags are treated as metadata and no schedules are started.
- Scheduler uses `setTimeout` chaining, which keeps it portable across supported runtimes.
- Startup and execution lifecycle messages are emitted via `resources.logger`.
- On `events.disposing`, cron stops all pending schedules immediately (no new timer-driven runs), while already in-flight cron executions drain under the normal shutdown budgets.

Best practices:

- Keep cron task logic idempotent (retries, restarts, and manual reruns happen).
- Use `timezone` explicitly for business schedules to avoid DST surprises.
- Use `onError: "stop"` only when repeated failure should disable the schedule.
- Keep cron tasks thin; delegate heavy logic to regular tasks for reuse/testing.

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

### Basic Semaphore Usage

```typescript
import { Semaphore } from "@bluelibs/runner";

// Allow max 5 concurrent database queries
const dbSemaphore = new Semaphore(5);

// Preferred: automatic acquire/release
const users = await dbSemaphore.withPermit(async () => {
  return await db.query("SELECT * FROM users");
}); // Permit released automatically, even if query throws
```

**Pro Tip**: You don't always need to use `Semaphore` manually. The `concurrency` middleware (available via `middleware.task.concurrency`) provides a declarative way to apply these limits to your tasks.

### Manual Acquire/Release

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

### From Utilities to Middleware

While `Semaphore` and `Queue` provide powerful manual control, Runner often wraps these into declarative middleware for common patterns:

- **concurrency**: Uses `Semaphore` internally to limit task parallelization.
- **temporal**: Uses timers and promise-tracking to implement `debounce` and `throttle`.
- **rateLimit**: Uses fixed-window counting to protect resources from bursts.

**What you just learned**: Utilities are the building blocks; Middleware is the blueprint for common resilience patterns.

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

### Basic Queue Usage

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

### Cancellation Support

Each task receives an `AbortSignal` for cooperative cancellation. Plain `queue.dispose()` drains already-queued work, while `queue.dispose({ cancel: true })` switches into teardown mode and aborts the active task cooperatively:

```typescript
import { Queue } from "@bluelibs/runner";

const queue = new Queue();

// Queue up some work
const result = await queue.run(async (signal) => {
  // Your async task here
  return "Task completed";
});

// Graceful drain
await queue.dispose();
```

### AbortController Integration

The Queue provides each task with an `AbortSignal` for cooperative cancellation. Tasks should periodically check this signal to enable early termination when you explicitly dispose with `{ cancel: true }`.

### Examples

**Example: Long-running Task**

```typescript
const queue = new Queue();

// Task that respects cancellation
const processLargeDataset = queue.run(async (signal) => {
  const items = await fetchLargeDataset();

  for (const item of items) {
    signal.throwIfAborted();

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
- `executionContext`: AsyncLocalStorage-based execution bookkeeping for correlation ids and causal-chain tracking

#### Implement Cooperative Cancellation

Tasks should regularly check the `AbortSignal` and respond appropriately:

```typescript
// Preferred: Use signal.throwIfAborted() for immediate termination
signal.throwIfAborted();

// Alternative: Check signal.aborted for custom handling
if (signal.aborted) {
  cleanup();
  signal.throwIfAborted();
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

### Lifecycle Events (Isolated EventManager)

`Queue` also publishes local lifecycle events for lightweight telemetry. Each Queue instance has its own **isolated EventManager**—these events are local to the Queue and are completely separate from the global EventManager used for business-level application events.

- `enqueue` · `start` · `finish` · `error` · `cancel` · `disposed`

```typescript
const q = new Queue();
q.on("start", ({ taskId }) => console.log(`task ${taskId} started`));
await q.run(async () => "ok");
await q.dispose({ cancel: true }); // emits cancel + disposed
```
