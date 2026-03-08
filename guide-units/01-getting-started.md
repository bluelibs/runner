## What Is This Thing?

Runner is dependency injection for async systems. The two nouns that matter first are **task** and **resource**: tasks hold business actions, resources hold shared state plus lifecycle.

### The Mental Model

- **Task**: business logic with typed input, dependencies, middleware, and output
- **Resource**: a shared singleton with `init`, `ready`, `cooldown`, and `dispose`
- **Event**: a typed signal
- **Hook**: a reaction to an event
- **App**: the root resource that registers the graph
- **Runtime**: what `run(app)` returns so you can execute tasks and dispose cleanly

In one line:

```text
task/resource/event/hook definitions -> app.register(...) -> run(app) -> runtime helpers
```

### When Runner Fits

- Services, workers, APIs, or apps with several long-lived dependencies
- Teams that care about explicit wiring and predictable startup/shutdown
- Codebases that need both fast unit tests and full runtime integration tests
- Projects where middleware and observability should stay out of business logic

### When Runner Is Probably Too Much

- Tiny scripts where plain functions are already clear enough
- Teams that specifically want decorator-heavy conventions or a full web framework

## Your First 5 Minutes

Here is the shortest path to a first successful run:

1. **Tasks** are your business logic functions
2. **Resources** are shared services (database, config, etc.)
3. **You compose them** using `r.resource()` and `r.task()`
4. **You run them** with `run(app)` which gives you `runTask()` and `dispose()`

Now let's prove it with the smallest runnable example:

## Quick Start

```bash
npm install @bluelibs/runner
```

```typescript
import { r, run } from "@bluelibs/runner";

const greet = r
  .task("greet")
  .run(async (name: string) => `Hello, ${name}!`)
  .build();

const app = r
  .resource("app")
  .register([greet])
  .build();

const { runTask, dispose } = await run(app);
const message = await runTask(greet, "World");
console.log(message);
await dispose();
```

**Expected output:**

```
Hello, World!
```

**What you just learned**: Define -> Register -> Run -> Execute.

**Fail-fast tip**: `run(app, { dryRun: true })` validates the graph without starting resources, which is useful in CI and wiring checks.

### What Happens When Wiring Is Wrong?

Runner fails early when the graph is inconsistent.

```typescript
const brokenTask = r
  .task("brokenTask")
  .dependencies({ missingResource })
  .run(async () => "never gets here")
  .build();
```

If `missingResource` is not registered in the app, startup fails before the task can run. That is intentional: wiring errors should not surface as production traffic bugs.

## Show Me the Wiring

This example is intentionally partial. It focuses on execution boundaries and policy wiring, not the implementations of `db` or `mockDb`.

```typescript
import { middleware, r } from "@bluelibs/runner";

const getUser = r
  .task<string>("getUser")
  .dependencies({ db })
  .middleware([middleware.task.cache.with({ ttl: 60000 })])
  .run(async (id, { db }) => db.query("SELECT * FROM users WHERE id = ?", id))
  .build();

const callApi = r
  .task("callApi")
  .middleware([middleware.task.retry.with({ retries: 3 })])
  .run(async (url: string) => fetch(url))
  .build();

test("getUser unit test", async () => {
  const result = await getUser.run("user-123", { db: mockDb });
  expect(result.name).toBe("John");
});
```

**Boundary that matters**: direct `.run()` is great for isolated unit tests, but it bypasses runtime concerns such as registration checks and the full execution path. Use `runTask()` when you want the whole runtime contract.

### Building a Real Express Server

Now that you've seen the basics, here's a real Node-oriented example with lifecycle and logging.

**Boundary**: this example targets Node.js because it starts an HTTP server.

```bash
npm install @bluelibs/runner express zod
```

```typescript
import express from "express";
import { r, resources, run } from "@bluelibs/runner";
import { z } from "zod";

const server = r
  .resource<{ port: number }>("server")
  .init(
    async ({ port }) =>
      new Promise((resolve) => {
        const app = express();
        app.use(express.json());
        const listener = app.listen(port, () => {
          console.log(`Server running on port ${port}`);
          resolve({ app, listener });
        });
      }),
  )
  .dispose(
    async ({ listener }) => new Promise((resolve) => listener.close(resolve)),
  )
  .build();

const createUser = r
  .task("createUser")
  .dependencies({ server, logger: resources.logger })
  .inputSchema(z.object({ name: z.string() }))
  .run(async (input, { logger }) => {
    await logger.info(`Creating ${input.name}`);
    return { id: "user-123", name: input.name };
  })
  .build();

const app = r
  .resource("app")
  .register([server.with({ port: 3000 }), createUser])
  .dependencies({ server, createUser })
  .init(async (_config, { server, createUser }) => {
    server.app.post("/users", async (req, res) => {
      const user = await createUser(req.body);
      res.json(user);
    });
  })
  .build();

const { runTask, dispose } = await run(app);
const user = await runTask(createUser, { name: "Ada" });
console.log(user);
await dispose();
```

**Expected output:**

```
Server running on port 3000
Creating Ada
{ id: 'user-123', name: 'Ada' }
```

**What this proves**:

- lifecycle lives with the resource
- task dependencies stay explicit
- the runtime stays small: `runTask()` and `dispose()` cover the main path
- ids stay local and readable: `server`, `createUser`, `app`

> **runtime:** "An Express server with DI, validation, logging, and graceful shutdown. And you didn't write a single decorator. I'm almost proud."

### Classic API (still supported)

Prefer fluent builders for new code, but the classic `define`-style API remains supported and can be mixed in the same app:

```ts
import { resource, task, run } from "@bluelibs/runner";

const db = resource({ id: "db", init: async () => "conn" });
const add = task({
  id: "add",
  run: async (i: { a: number; b: number }) => i.a + i.b,
});

const app = resource({ id: "app", register: [db, add] });
await run(app);
```

See [Fluent Builders](#fluent-builders-r) for migration tips and side-by-side patterns.

### Platform & Async Context

Runner auto-detects the platform (Node.js, browser, edge) and adapts behavior at runtime.

**Node-specific features:**

- [Async Context](#async-context) - Request-scoped state via `AsyncLocalStorage`
- [Durable Workflows](./readmes/DURABLE_WORKFLOWS.md) - Replay-safe, persistent workflows
- [Remote Lanes](./readmes/REMOTE_LANES.md) - Remote task/event execution

## How Does It Compare?

Use this section if you are still deciding whether Runner is the right tool.

- **Choose Runner** when you want explicit composition, lifecycle-aware resources, and middleware without decorator or reflection lock-in.
- **Choose NestJS** when you want a full opinionated web framework with a large ecosystem and built-in conventions.
- **Choose Effect** when you want a pervasive FP runtime model and algebraic effects across the codebase.
- **Choose a smaller DI container** when you only need class-based injection and do not need Runner's lifecycle and policy surface.

### Quick Comparison Matrix

| Feature                  | Runner                                      | NestJS                   | Effect (TS)                       | InversifyJS            | TypeDI                 | tsyringe               |
| ------------------------ | ------------------------------------------- | ------------------------ | --------------------------------- | ---------------------- | ---------------------- | ---------------------- |
| **Programming Paradigm** | Functional-first                            | OOP/Class-based          | Functional, algebraic             | OOP/Class-based        | OOP/Class-based        | OOP/Class-based        |
| **DI Mechanism**         | Explicit, no reflection                     | Decorators, reflection   | Layers & Services (no reflection) | Decorators, reflection | Decorators, reflection | Decorators, reflection |
| **Test Isolation**       | Easy                                        | Moderate                 | Easy (Layers)                     | Moderate               | Moderate               | Moderate               |
| **Lifecycle**            | First-class resources                       | Module/app lifecycle     | Runtime-managed                   | Minimal                | Minimal                | Minimal                |
| **Middleware**           | Composable, type-safe                       | Guard/Interceptor system | Aspect-oriented via Layers        | N/A                    | N/A                    | N/A                    |
| **Platform Scope**       | Multi-platform, some features Node-only     | Primarily server-side    | Multi-platform                    | General-purpose        | General-purpose        | General-purpose        |

**Runner tradeoffs**:

- more upfront graph design than plain functions
- less convention than full-stack frameworks
- best value once the app has real lifecycle and cross-cutting concerns

> For a deeper side-by-side code comparison with NestJS, see [Framework Comparison](./readmes/COMPARISON.md).

## What's in the Box?

After the first example, the value is breadth without extra packages:

- **Core architecture**: dependency injection, resource lifecycle, task execution, events and hooks
- **Policies**: caching, retry, timeouts, logging, concurrency controls
- **Developer experience**: fluent builders, testing utilities, debug tools, TypeDoc integration
- **Advanced features**: Async Context, Durable Workflows, Remote Lanes, serialization, overrides

**Boundary reminder**: some advanced features are Node-only. Use the dedicated guides when platform support matters.

## Learning Guide

These patterns will save you hours of debugging. Each one addresses a real mistake we've seen developers make when learning Runner.

**What you'll learn:**

- When to use tasks vs regular functions
- How to properly wire up and execute tasks
- Common gotchas with registration and configuration
- Typed error handling
- Two testing strategies (teaser -- full details in [Testing](#testing))

### Pattern 1: Not Everything Needs to Be a Task

When you're starting out, it's tempting to make everything a task. Here's the golden rule: **use regular functions for utilities, use tasks for business operations**.

```typescript
// Regular functions are perfect for utilities
const add = (a: number, b: number) => a + b;
const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`;

// Tasks are great for business operations
const processOrder = r
  .task("app.processOrder")
  .run(async (input) => {
    const total = add(input.price, input.tax); // Use regular functions inside!
    return {
      orderId: input.id,
      total: formatCurrency(total),
      status: "processed",
    };
  })
  .build();
```

**Want detailed guidance?** See the [Tasks section](#tasks) below for a comprehensive breakdown of when to use tasks vs. functions.

### Pattern 2: The Right Way to Call Tasks

This one trips everyone up at first! Here's the pattern:

```typescript
// 1. Create your app resource
const app = r
  .resource("app")
  .register([myTask]) // Register your tasks here
  .build();

// 2. Run the app to get the runtime
const { runTask, dispose } = await run(app);

// 3. Now you can execute tasks
const result = await runTask(myTask, { input: "data" });

// 4. Clean up when done
await dispose();
```

**Remember**: You `run()` the **app**, then you `runTask()` the **task**. Think of it like starting a car (run the app) before you can drive it (runTask).

### Pattern 3: Two Ways to Test

Runner gives you two testing strategies with different tradeoffs:

```typescript
// Unit Testing: Call .run() directly with mocks
// This BYPASSES middleware - fast and isolated
test("calculateTotal", async () => {
  const result = await calculateTotal.run(
    { price: 100 },
    { taxService: mockTaxService }, // Mock dependencies
  );
  expect(result).toBe(110);
});

// Integration Testing: Use the full runtime
// This runs through the FULL pipeline including middleware
test("full order flow", async () => {
  const { runTask, dispose } = await run(app);
  const result = await runTask(processOrder, { orderId: "123" });
  expect(result.status).toBe("processed");
  await dispose();
});
```

**Tip**: Start with unit tests (faster, simpler), then add integration tests for critical flows. See [Testing](#testing) for override patterns, isolation strategies, and more.

### Pattern 4: Remember to Register

This is easy to forget when you're moving fast:

```typescript
// The complete pattern
const database = r
  .resource("db")
  .init(async () => connectToDB())
  .build();

const myTask = r
  .task("myTask")
  .dependencies({ database }) // Declare what you need
  .run(async (input, { database }) => {
    // Use it here
  })
  .build();

const app = r
  .resource("app")
  .register([
    database, // <- Don't forget to register!
    myTask,
  ])
  .build();
```

**Think of it this way**: `dependencies` says "I need these things" and `register` says "these things exist". Both are needed!

### Pattern 5: Configure Resources with `.with()`

Resources often need configuration. Use `.with()` to pass it:

```typescript
// Define the resource with a config type
const database = r
  .resource<{ connectionString: string }>("db")
  .init(async ({ connectionString }) => connect(connectionString))
  .build();

// Configure when registering
const app = r
  .resource("app")
  .register([database.with({ connectionString: "postgres://..." })])
  .build();
```

### Pattern 6: Built-in APIs

Runner provides commonly-used resources and middleware out of the box:

```typescript
import { r } from "@bluelibs/runner";

const myTask = r
  .task("myTask")
  .dependencies({ logger: resources.logger }) // Built-in logger
  .middleware([middleware.task.cache.with({ ttl: 60000 })]) // Built-in cache
  .run(async (input, { logger }) => {
    await logger.info("Processing...");
  })
  .build();
```

See [Quick Wins](#quick-wins-pressure-tested-recipes) for ready-to-use examples with built-in Runner APIs.

### Pattern 7: Typed Errors

Runner provides a fluent error builder so your errors are typed, namespaced, and inspectable:

```typescript
import { r } from "@bluelibs/runner";

// Define a typed error
const InvalidCredentials = r
  .error<{ email: string }>("invalidCredentials")
  .httpCode(401)
  .remediation("Check that the email and password are correct.")
  .format((data) => `Invalid credentials for ${data.email}`)
  .build();

// Throw it
InvalidCredentials.throw({ email: "ada@example.com" });

// Catch it
try {
  await login(credentials);
} catch (err) {
  if (InvalidCredentials.is(err)) {
    console.log(err.data.email); // "ada@example.com"
    console.log(err.httpCode); // 401
  }
  // Or check if it's any Runner error at all
  if (r.error.is(err)) {
    console.log(err.id); // "invalidCredentials"
  }
}
```

See [Errors](#errors) for `throws` contracts and advanced patterns.

---

**Key takeaway**: Define -> Register -> Run -> Execute. That's the rhythm of every Runner application.

### What's Next?

Now that you know the patterns, here's your learning path:

1. **[Quick Wins](#quick-wins-pressure-tested-recipes)** - Production recipes for caching, retry, timeouts
2. **[The Big Five](#the-big-five)** - Deep dive into Tasks, Resources, Events, Middleware, Tags
3. **[Events & Hooks](#events)** - Decouple your app with event-driven patterns
4. **[Middleware](#middleware)** - Add cross-cutting concerns cleanly
5. **[Testing](#testing)** - Unit tests, integration tests, overrides, and isolation
6. **[Troubleshooting](#troubleshooting)** - Common issues and how to fix them

> **runtime:** "Seven patterns. That's it. You just learned what takes most developers three debugging sessions and a Stack Overflow rabbit hole to figure out. The other 10% of midnight emergencies? That's why I log everything."

---
