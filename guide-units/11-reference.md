## Quick Reference: Cheat Sheet

**Bookmark this section for quick lookups!**

### Creating Components

```typescript
import { r, globals } from "@bluelibs/runner";

const { cache, retry } = globals.middleware.task;

// Assuming: db and logger are resources defined elsewhere
// Task - Basic
const myTask = r
  .task("id")
  .run(async (input) => result)
  .build();

// Task - With Dependencies
const myTask = r
  .task("id")
  .dependencies({ db, logger })
  .run(async (input, { db, logger }, context) => {
    // context?.journal is auto-injected
    // context?.source => { kind, id }
    return result;
  })
  .build();

// Task - With Middleware
const myTask = r
  .task("id")
  .middleware([cache.with({ ttl: 60000 }), retry.with({ retries: 3 })])
  .run(async (input) => result)
  .build();

// Resource - Basic
const myResource = r
  .resource("id")
  .init(async () => ({ value: "something" }))
  .build();

// Resource - With Lifecycle
const myResource = r
  .resource("id")
  .init(async () => connection)
  .cooldown(async (connection) => {
    // Stop intake quickly (for example, stop new HTTP connections)
    connection.stopAccepting?.();
  })
  .dispose(async (connection) => connection.close())
  .build();

// Event
const myEvent = r
  .event("id")
  .payloadSchema<{ data: string }>({ parse: (v) => v })
  .build();

// Transactional event (listeners must return undo closure)
const myTransactionalEvent = r
  .event("id.transactional")
  .payloadSchema<{ data: string }>({ parse: (v) => v })
  .transactional()
  .build();

// Event Lane (reference target for queue routing)
const notificationsLane = r.eventLane("app.lanes.notifications").build();
const topology = r.eventLane.topology({
  profiles: { worker: { consume: [notificationsLane] } },
  bindings: [{ lane: notificationsLane, queue: { id: "queue.ref" } }],
});

// Hook
const myHook = r
  .hook("id")
  .on(myEvent)
  .run(async (event) => console.log(event.data))
  .build();

// Error Helper
const appError = r
  .error<{ code: number; message: string }>("app.errors.AppError")
  .build();

// Tag (scoped to one kind - shorthand)
const auditTag = r.tag("app.tags.audit").for("tasks").build();

// Tag (scoped to multiple kinds)
const discoverableTag = r
  .tag("app.tags.discoverable")
  .for(["tasks", "resources"])
  .build();

// Async Context (Node-only)
const requestContext = r
  .asyncContext<{ requestId: string }>("app.ctx.request")
  .build();
```

`resource.cooldown(value, config, dependencies, context): Promise<void>`
- Runs at shutdown start (right after `disposing`, before `globals.events.disposing` and before drain waiting).
- Use for ingress-stop behavior; it can be async, but should return quickly by contract.
- Intended mostly for ingress/front-door resources (HTTP/tRPC/websocket/consumer boundaries) that admit new work.
- Avoid using it for infrastructure resources that tasks still need during drain (for example, database or cache resources); keep those for `dispose()`.
- Ordering matches dispose ordering (reverse dependency waves; same-wave parallelism in parallel lifecycle mode).

### Running Your App

```typescript
// Basic
const basicRuntime = await run(app);
const { runTask, dispose } = basicRuntime;

// With options
const configuredRuntime = await run(app, {
  debug: "verbose", // "normal" | "verbose" | Partial<DebugConfig>
  logs: {
    printThreshold: "info",
    printStrategy: "pretty",
    bufferLogs: false,
  },
  errorBoundary: true,
  shutdownHooks: true,
  disposeBudgetMs: 30_000,
  disposeDrainBudgetMs: 30_000,
  onUnhandledError: ({ error }) => console.error(error),
  dryRun: false,
  lazy: false,
  lifecycleMode: "sequential", // "sequential" | "parallel"
  runtimeEventCycleDetection: true,
  mode: "prod", // "dev" | "prod" | "test"
});
const { runTask: runTaskWithOptions, dispose: disposeWithOptions } =
  configuredRuntime;

// Execute tasks
const result = await runTask(myTask, input);

// Cleanup
await dispose();
await disposeWithOptions();
```

| Run Option                    | Purpose                                                                 |
| ---------------------------- | ----------------------------------------------------------------------- |
| `debug`                      | Enable Runner debug logging                                             |
| `logs`                       | Configure logger strategy/threshold/buffering                           |
| `errorBoundary`              | Catch process-level unhandled exceptions/rejections                     |
| `shutdownHooks`              | Auto-handle SIGINT/SIGTERM with graceful shutdown (also during bootstrap) |
| `disposeBudgetMs`            | Total disposal wait budget (ms) across resource cooldown, disposing hooks, drain wait, drained hooks, and resource disposal |
| `disposeDrainBudgetMs`       | Drain wait budget (ms) for in-flight tasks/event listeners; capped by remaining `disposeBudgetMs` (`0` disables drain waiting) |
| `onUnhandledError`           | Custom handler for normalized unhandled errors                          |
| `dryRun`                     | Validate graph without running resource `init()`                        |
| `lazy`                       | Defer startup-unused resources until on-demand access                   |
| `lifecycleMode`              | Choose startup/dispose scheduler strategy (`sequential` or `parallel`) |
| `runtimeEventCycleDetection` | Detect event cycles at runtime and fail fast                            |
| `mode`                       | Override environment mode detection (`dev` / `prod` / `test`)           |

Event source contract:
`IEventEmission.source` is a structured object: `{ kind: "runtime" | "resource" | "task" | "hook" | "middleware"; id: string }`.

### Testing Patterns

```typescript
// Unit Test - Direct call
const result = await myTask.run(input, { db: mockDb, logger: mockLogger });

// Integration Test - Full runtime
const { runTask, dispose } = await run(testApp);
const result = await runTask(myTask, input);
await dispose();
```

### Override Patterns

```typescript
import { override, r } from "@bluelibs/runner";

const realMailer = r
  .resource("app.mailer")
  .init(async () => new SMTPEmailer())
  .build();

// Typed shorthand
const shorthandMockMailer = r.override(realMailer, async () => new MockMailer());

// Helper override
const helperMockMailer = override(realMailer, {
  init: async () => new MockMailer(),
});

const app = r
  .resource("app")
  .register([realMailer])
  .overrides([shorthandMockMailer, helperMockMailer])
  .build();
```

Quick rule:
- `r.override(...)` builds the replacement definition.
- `.overrides([...])` applies replacement during bootstrap.
- Registering only the replacement definition is valid.
- Registering both base and replacement in `.register([...])` causes duplicate-id errors.

### Built-in Middleware

```typescript
import { globals } from "@bluelibs/runner";

// Cache
globals.middleware.task.cache.with({
  ttl: 60000, // milliseconds
  keyBuilder: (taskId, input) => `${taskId}:${input.id}`,
});

// Retry
globals.middleware.task.retry.with({
  retries: 3,
  delayStrategy: (attempt) => 100 * Math.pow(2, attempt),
  stopRetryIf: (error) => error.permanent,
});

// Timeout
globals.middleware.task.timeout.with({ ttl: 5000 });
```

### Common Patterns

```typescript
// Register components
const app = r.resource("app")
  .register([task1, task2, resource1])
  .build();

// With dependencies
const app = r.resource("app")
  .register([db, logger])
  .dependencies({ db, logger })
  .init(async (_config, { db, logger }) => {
    // Use dependencies
  })
  .build();

// With configuration
const server = r.resource<{ port: number }>("server")
  .init(async ({ port }) => startServer(port))
  .build();

const app = r.resource("app")
  .register([server.with({ port: 3000 })])
  .build();

// Emit events
await myEvent({ data: "value" });

// Emit with options
const emitReport = await myEvent(
  { data: "value" },
  { failureMode: "aggregate", throwOnError: false, report: true },
);

// Runtime emit helper supports the same options
const runtime = await run(app);
await runtime.emitEvent(myEvent, { data: "value" }, { report: true });

// Global logging
const task = r.task("id")
  .dependencies({ logger: globals.resources.logger })
  .run(async (input, { logger }) => {
    await logger.info("message", { data: {...} });
  })
  .build();
```

### Resource Isolation (`.exports`)

```typescript
const internalTask = r.task("billing.tasks.internal").run(async () => 1).build();
const publicTask = r.task("billing.tasks.public").run(async () => 2).build();

const billing = r
  .resource("billing")
  .register([internalTask, publicTask])
  .isolate({ exports: [publicTask] }) // only this is visible outside billing
  .build();
```

Quick rules:
- No isolate `exports` means everything public (backward compatible)
- `isolate: { exports: [] }` / `isolate: { exports: "none" }` means everything private outside that subtree
- `isolate: { exports: ["billing.public.*"] }` supports string id selectors (`*` = one dot-segment) and selectors must match at least one id at bootstrap
- The same selector semantics apply to `isolate({ deny: [...] })` and `isolate({ only: [...] })`
- Tag definition vs string id is intentional in `deny`/`only`: `deny: [someTag]` blocks tag carriers, while `deny: [someTag.id]` blocks only the exact id
- Use `isolate({ deny: [globals.tags.containerInternals] })` to block privileged container resources (`globals.resources.store`, `globals.resources.taskRunner`, `globals.resources.middlewareManager`, `globals.resources.eventManager`, `globals.resources.runtime`) inside a boundary
- Visibility is enforced at `run(app)` bootstrap
- Wiring checks include dependencies, hook event subscriptions, and middleware attachments (task + resource middleware)
- Subtree middleware (`resource.subtree({ tasks/resources: { middleware: [...] } })`) applies to the declaring resource subtree only
- Subtree validators are return-based: `validate(definition)` must return `SubtreeViolation[]` (do not throw for normal policy failures)
- Runner aggregates subtree validation violations and throws a single `subtreeValidationFailedError` at bootstrap
- If a subtree validator throws or returns a non-array, Runner records an `invalid-definition` violation and still throws the aggregated subtree error
- For catch-all task interception, use `taskRunner.intercept(...)` from resource dependencies
- Duplicate ids still fail globally, even for private items

`SubtreeViolation` shape:

```typescript
type SubtreeViolation = {
  code: string;
  message: string;
};
```

### Event Emission Options

| Option         | Type                              | Default      | Purpose                                      |
| -------------- | --------------------------------- | ------------ | -------------------------------------------- |
| `failureMode`  | `"fail-fast" \| "aggregate"`      | `fail-fast`  | Stop on first listener error or aggregate all |
| `throwOnError` | `boolean`                         | `true`       | Throw after listener failure(s)               |
| `report`       | `boolean`                         | `false`      | Return `IEventEmitReport` for listener outcomes |

Transactional notes:
- Transactional events always execute with fail-fast rollback semantics.
- Executed listeners must return async undo closures.
- `transactional + parallel` and `transactional + globals.tags.eventLane` are rejected at runtime sanity checks.

### Type Helpers

```typescript
import type { TaskInput, TaskOutput, ResourceValue } from "@bluelibs/runner";

type Input = TaskInput<typeof myTask>; // Get task input type
type Output = TaskOutput<typeof myTask>; // Get task output type
type Value = ResourceValue<typeof myResource>; // Get resource value type
```

### Performance Tips

| Pattern                   | When to Use                        | Code                                         |
| ------------------------- | ---------------------------------- | -------------------------------------------- |
| **Caching**               | Expensive computations, DB queries | `.middleware([cache.with({ ttl: 60000 })])`  |
| **Timeouts**              | External APIs, network calls       | `.middleware([timeout.with({ ttl: 5000 })])` |
| **Retry**                 | Transient failures, flaky services | `.middleware([retry.with({ retries: 3 })])`  |
| **Events**                | Decoupling, async side effects     | `await userRegistered({ userId, email })`    |
| **Single responsibility** | Maintainability                    | One task = one action                        |

### Debugging

```typescript
// Enable debug logging
await run(app, { debug: "verbose" });

// Add per-component debug
const task = r.task("id")
  .tags([globals.tags.debug.with({ logTaskInput: true, logTaskOutput: true })])
  .run(...)
  .build();

// Access logger
.dependencies({ logger: globals.resources.logger })
```

### Concurrency Utilities

```typescript
import { Semaphore, Queue } from "@bluelibs/runner";

// Semaphore - limit concurrent operations
const sem = new Semaphore(3); // max 3 concurrent
await sem.acquire();
try {
  await doWork();
} finally {
  sem.release();
}

// Queue - sequential task processing
const queue = new Queue();
await queue.run(async (_signal) => {
  /* runs in order */
});
await queue.run(async (_signal) => {
  /* waits for previous */
});
```

---

## Why Choose BlueLibs Runner?

After reading this far, here's what you've learned:

| Concept            | What you can do                                       |
| ------------------ | ----------------------------------------------------- |
| **Tasks**          | Write testable business logic with DI                 |
| **Resources**      | Manage singletons with lifecycle                      |
| **Events & Hooks** | Decouple your application                             |
| **Middleware**     | Add caching, retry, timeouts in one line              |
| **Testing**        | Unit test with mocks, integration test with overrides |
| **Lifecycle**      | Graceful startup and shutdown                         |

### What sets Runner apart

- **Type Safety**: Full TypeScript support with intelligent inference—not just "any" everywhere
- **Testability**: Call `.run()` directly with mocks. No app runtime setup, no magic
- **Clarity**: Dependencies are explicit. No decorators, no reflection, no surprises
- **Performance**: Middleware overhead is ~0.00026ms. Tests run in milliseconds
- **Batteries included**: Caching, retry, timeouts, events, logging—all built in

> **runtime:** "Why choose it? The bullets are persuasive. Keep your tasks small and your dependencies explicit, and the code stays tidy. Ignore the types and I can't save you—but I'll still log the crash with impeccable manners."

## The Migration Path

Runner can be adopted incrementally. No big-bang rewrites required.

**Step 1**: Create one resource for something you need (database, config, service)

```typescript
const database = r
  .resource("app.db")
  .init(async () => yourExistingConnection)
  .build();
```

**Step 2**: Create one task for a piece of business logic

```typescript
const createUser = r
  .task("users.create")
  .dependencies({ database })
  .run(yourExistingFunction)
  .build();
```

**Step 3**: Compose them into an app and run

```typescript
const app = r.resource("app").register([database, createUser]).build();
await run(app);
```

Repeat. Gradually, your spaghetti becomes lasagna.

> **runtime:** "'No big bang rewrites.' Start with one resource and one task, then migrate incrementally. I'll keep the wiring honest while you refactor—one small, reversible step at a time."

## Release, Support, and Deprecation Policy

Use these links as the canonical upgrade entrypoints:

- [GitHub Releases](https://github.com/bluelibs/runner/releases) - tagged releases and release assets
- [Enterprise Policy](./readmes/ENTERPRISE.md) - support windows and governance

Current support channels:

- **Stable**: `5.x` (current feature line)
- **Maintenance/LTS**: `4.x` (critical fixes only)

### Deprecation lifecycle

When a public API is deprecated, use this lifecycle:

| Stage             | What Happens                                                        | Removal |
| ----------------- | ------------------------------------------------------------------- | ------- |
| **Announced**     | Release note entry + docs note with replacement path                | No      |
| **Warned**        | Deprecated marker in docs/types and migration recommendation        | No      |
| **Removed**       | Removed in next allowed major with migration notes in release notes | Yes     |

If a behavior changes without breaking types (for example default values), document it in your release notes.

## Production Readiness Checklist

Use this list before promoting a Runner app to production:

### Build and Runtime

- Pin Node to a supported LTS line (`>=18`)
- Build in CI with `npm run qa`
- Run from compiled output (no ts-node in production path)

### Security

- Configure exposure auth for tunnels (`http.auth`) and avoid anonymous exposure
- Use allow-lists for remotely callable task/event ids
- Set payload limits for JSON/multipart traffic
- Review logs for sensitive data before enabling external sinks

### Reliability

- Define timeout/retry/circuit-breaker defaults for external I/O tasks
- Verify graceful shutdown path with `SIGTERM` in staging
- Ensure resource disposal order is validated in integration tests

### Observability

- Emit structured logs with stable `source` ids
- Track latency and error-rate metrics per critical task path
- Export traces for cross-service flows
- Configure baseline alerts for error-rate spikes and sustained p95 latency

### Operations

- Expose `/health` (or equivalent) and wire container/platform checks
- Maintain runbooks for incident triage and rollback
- Review release notes before upgrades and test migrations in staging

## Node API Index

Node-only entrypoint: `@bluelibs/runner/node`.

| Export                                                | Purpose                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `nodeExposure`                                        | Expose tasks/events over HTTP                                           |
| `createHttpMixedClient`, `createHttpSmartClient`      | Node tunnel clients (JSON + multipart + streaming modes)                |
| `createNodeFile`, `NodeInputFile`                     | Build Node file inputs for multipart tunnel calls                       |
| `readInputFileToBuffer`, `writeInputFileToPath`       | Convert `InputFile` payloads to `Buffer` or persisted file path         |
| `useExposureContext`, `hasExposureContext`            | Access request/response/signal in exposed task execution                |
| `memoryDurableResource`, `redisDurableResource`, etc. | Durable workflow runtime, stores, and helpers                           |
| `eventLanesResource`                                  | Node Event Lanes runtime resource (lane interception + profile consumers) |
| `MemoryEventLaneQueue`, `RabbitMQEventLaneQueue`      | Built-in Event Lanes queue adapters                                     |
| `EventLaneMessage`                                    | Queue message contract for Event Lanes transport                        |
| `bindEventLane`                                       | Immutable helper for lane-to-queue binding objects                      |
| `EventLaneQueueReference`, `EventLaneQueueResource`   | Queue binding references (direct queue instance or container resource)   |
| `EventLanesTopology`, `EventLanesResourceWithConfig`  | Topology-first config types for centralized Event Lanes wiring           |
| `IEventLaneQueue`                                     | Interface for custom Event Lanes backends (`enqueue`, `consume`, `ack`, `nack`, optional `setPrefetch`/`init`/`dispose`) |

See also:

- [REMOTE_LANES.md](./readmes/REMOTE_LANES.md) for transport semantics
- [DURABLE_WORKFLOWS.md](./readmes/DURABLE_WORKFLOWS.md) for workflow APIs

## Community & Support

This is part of the [BlueLibs](https://www.bluelibs.com) ecosystem. We're not trying to reinvent everything – just the parts that were broken.

- [GitHub Repository](https://github.com/bluelibs/runner) - if you find this useful
- [Documentation](https://bluelibs.github.io/runner/) - When you need the full details
- [Issues](https://github.com/bluelibs/runner/issues) - When something breaks (or you want to make it better)
- [Contributing](./.github/CONTRIBUTING.md) - How to file great issues and PRs

_P.S. - Yes, we know there are 47 other JavaScript frameworks. This one's still different._

> **runtime:** "'This one's different.' Sure. You're all unique frameworks, just like everyone else. To me, you're all 'please run this async and don't explode,' but the seasoning here is… surprisingly tasteful."

## License

This project is licensed under the MIT License - see the [LICENSE.md](./LICENSE.md) file for details.

> **runtime:** "MIT License: do cool stuff, don't blame us. A dignified bow. Now if you'll excuse me, I have sockets to tuck in and tasks to shepherd."

