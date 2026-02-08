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
  .run(async (input, { db, logger }) => result)
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
  .dispose(async (connection) => connection.close())
  .build();

// Event
const myEvent = r
  .event("id")
  .payloadSchema<{ data: string }>({ parse: (v) => v })
  .build();

// Hook
const myHook = r
  .hook("id")
  .on(myEvent)
  .run(async (event) => console.log(event.data))
  .build();
```

### Running Your App

```typescript
// Basic
const { runTask, dispose } = await run(app);

// With options
const { runTask, dispose } = await run(app, {
  debug: "verbose", // "normal" | "verbose"
  onUnhandledError: ({ error }) => console.error(error),
});

// Execute tasks
const result = await runTask(myTask, input);

// Cleanup
await dispose();
```

### Testing Patterns

```typescript
// Unit Test - Direct call
const result = await myTask.run(input, { db: mockDb, logger: mockLogger });

// Integration Test - Full runtime
const { runTask, dispose } = await run(testApp);
const result = await runTask(myTask, input);
await dispose();
```

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

// Global logging
const task = r.task("id")
  .dependencies({ logger: globals.resources.logger })
  .run(async (input, { logger }) => {
    await logger.info("message", { data: {...} });
  })
  .build();
```

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
