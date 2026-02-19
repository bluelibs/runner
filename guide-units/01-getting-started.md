## What Is This Thing?

BlueLibs Runner is a TypeScript-first dependency injection framework built around **tasks** (functions) and **resources** (singletons). It's explicit and composition-first: you write normal async functions; Runner wires dependencies, middleware, events/hooks, and lifecycle.

### The Core

- **Tasks are functions** - Your business logic, nicely packaged with dependency injection
- **Resources are singletons** - Database connections, configs, services -- things that live for your app's lifetime
- **Events are just events** - Decouple parts of your app so they can talk without tight coupling
- **Hooks are lightweight subscribers** - React to events without the overhead of full tasks
- **Middleware** - Add cross-cutting concerns (logging, auth, caching) without cluttering your business logic
- **Everything is async** - Built for modern JavaScript/TypeScript
- **Explicit beats implicit** - You'll always know what's happening and why
- **Type-safe by default** - Catch mistakes at compile time, not at 3am in production

### When to Use Runner

**Great fit for:**

- TypeScript applications that need structured dependency injection
- Long-running services (APIs, workers, daemons) with lifecycle management
- Projects where testability matters -- unit test with mocks, integration test with overrides
- Teams that want middleware patterns without decorator magic
- Applications growing beyond "one file" that need organization

**The honest take**: If your app has 3+ services that depend on each other and you're tired of manually passing things around, Runner pays off. If you're building a 50-line script, stick with plain functions.

> **runtime:** "I've seen what manually-wired dependency graphs look like at 2am. You don't want that life. Trust me, I run them."

---

## Show Me the Wiring

**Here's what explicit wiring looks like in practice:**

```typescript
import { r, globals } from "@bluelibs/runner";

// Built-in middleware from globals
const { cache, retry } = globals.middleware.task;

// Assuming: db is a resource defined elsewhere, and mockDb is its test double
// ONE LINE to add caching with TTL
const getUser = r
  .task("users.get")
  .dependencies({ db })
  .middleware([cache.with({ ttl: 60000 })]) // <- That's it. 1 minute cache.
  .run(async (id, { db }) => db.query("SELECT * FROM users WHERE id = ?", id))
  .build();

// ONE LINE to add retry with exponential backoff
const callAPI = r
  .task("api.call")
  .middleware([retry.with({ retries: 3 })]) // <- Auto-retry failures (default exponential backoff)
  .run(async (url) => fetch(url))
  .build();

// Testing stays direct
test("getUser works", async () => {
  const result = await getUser.run("user-123", { db: mockDb }); // <- Just call it
  expect(result.name).toBe("John");
});
```

**Nothing hidden here.** Each step is spelled out so you can trace dependencies, middleware, and tests without guessing.

---

## How Does It Compare?

### Quick Comparison Matrix

| Feature                  | Runner                                      | NestJS                   | Effect (TS)                       | InversifyJS            | TypeDI                 | tsyringe               |
| ------------------------ | ------------------------------------------- | ------------------------ | --------------------------------- | ---------------------- | ---------------------- | ---------------------- |
| **Programming Paradigm** | Functional-first                            | OOP/Class-based          | Functional, algebraic             | OOP/Class-based        | OOP/Class-based        | OOP/Class-based        |
| **DI Mechanism**         | Explicit, no reflection                     | Decorators, reflection   | Layers & Services (no reflection) | Decorators, reflection | Decorators, reflection | Decorators, reflection |
| **Type Safety**          | Full inference                              | Manual typing            | Full inference                    | Manual typing          | Manual typing          | Manual typing          |
| **Learning Curve**       | Gentle                                      | Steep                    | Steep (FP concepts)               | Moderate               | Moderate               | Moderate               |
| **Size**                 | Medium (tree-shakable)                      | Large                    | Large (modular)                   | Small                  | Small                  | Small                  |
| **Built-in Features**    | Broad toolkit                               | Full framework           | Broad toolkit                     | DI only                | DI only                | DI only                |
| **Test Isolation**       | Easy                                        | Moderate                 | Easy (Layers)                     | Moderate               | Moderate               | Moderate               |
| **Framework Lock-in**    | Minimal                                     | High                     | High (pervasive `Effect` wrapper) | Low                    | Low                    | Low                    |
| **Async Context**        | Yes (Node-only)                             | Partial (ecosystem)      | Built-in (FiberRef)               | No                     | No                     | No                     |
| **Middleware**           | Composable, type-safe                       | Guard/Interceptor system | Aspect-oriented via Layers        | N/A                    | N/A                    | N/A                    |
| **Events**               | First-class support                         | EventEmitter2            | PubSub module                     | N/A                    | N/A                    | N/A                    |
| **Durable Workflows**    | Yes (Node-only)                             | No (external libs)       | No                                | No                     | No                     | No                     |
| **HTTP Tunnels**         | Yes (server Node-only, client browser/edge) | No                       | No                                | No                     | No                     | No                     |
| **Ecosystem**            | Growing                                     | Mature, extensive        | Growing, active                   | Moderate               | Moderate               | Small                  |

> **Note:** This table is intentionally qualitative. Durable workflows are Node-only (via `@bluelibs/runner/node`), while HTTP tunnels require Node on the server/exposure side and work in any `fetch` runtime on the client side.

**Choose Runner when:**

- You need **built-in reliability primitives** -- circuit breakers, rate limiting, retry with backoff, caching, timeouts, fallbacks, and concurrency control are first-class, not bolted on
- You want **full type inference** -- dependencies, middleware configs, and task I/O are inferred, not manually typed
- **Testing speed matters** -- call `task.run(input, { mockDep })` directly; no framework test modules, no DI container setup
- You're building **any TypeScript application** (CLI tools, workers, services, serverless) -- Runner isn't web-specific
- You need **durable workflows** or **HTTP tunnels** for distributed task execution (Node.js)
- You want **middleware introspection** -- the ExecutionJournal exposes cache hits, retry attempts, circuit state, and more at runtime
- You're integrating into an existing project gradually -- no "rewrite in our style" requirement

**Choose NestJS when** you want a full opinionated web framework with a large ecosystem and established conventions.

**Choose Effect when** you want algebraic effects, structured concurrency, and are comfortable with a pervasive functional wrapper type around all your code.

**Choose a DI container (InversifyJS / TypeDI / tsyringe) when** you only need class-based dependency injection and want minimal surface area.

> For a detailed side-by-side code comparison with NestJS (service definition, testing, and capabilities), see [Framework Comparison](./readmes/COMPARISON.md).

> **runtime:** "Comparison tables are where frameworks go to feel validated. I just execute your tasks and keep the lights on."

---

## What's in the Box?

Runner comes with **everything you need** to build production apps:

<table>
<tr>
<td width="33%" valign="top">

**Core Architecture**

- Dependency Injection
- Lifecycle Management
- Type-safe Everything
- Zero Configuration
- Multi-platform (Node/Browser)

</td>
<td width="33%" valign="top">

**Built-in Features**

- Caching (LRU + Custom)
- Retry with Backoff
- Timeouts
- Event System
- Middleware Pipeline
- Async Context
- Serialization (Dates, RegExp, Binary)
- HTTP Client Factory
- File Upload Support

</td>
<td width="33%" valign="top">

**Developer Experience**

- Fluent API
- Debug Tools
- Error Boundaries
- Testing Utilities
- TypeDoc Integration
- Full TypeScript Support
- Tree-shakable

</td>
</tr>
<tr>
<td width="33%" valign="top">

**Observability**

- Structured Logging
- Task Interceptors
- Event Tracking
- Performance Metrics
- Debug Mode

</td>
<td width="33%" valign="top">

**Production Ready**

- Graceful Shutdown
- Typed Errors with `r.error()`
- Error Contracts (`throws`)
- Optional Dependencies
- Semaphore/Queue
- Concurrency Control

</td>
<td width="33%" valign="top">

**Advanced Patterns**

- Durable Workflows (Node)
- Tunnels (Distributed)
- Tags System
- Factory Pattern
- Namespacing
- Overrides
- Meta/Documentation

</td>
</tr>
</table>

**No extra packages needed.** It's all included and works together seamlessly. For more details, see [Features](#features) and [Advanced Patterns](#advanced-patterns).

---

## Your First 5 Minutes

**New to Runner?** Here's the absolute minimum you need to know:

1. **Tasks** are your business logic functions
2. **Resources** are shared services (database, config, etc.)
3. **You compose them** using `r.resource()` and `r.task()`
4. **You run them** with `run(app)` which gives you `runTask()` and `dispose()`

That's it! Now let's see it in action:

---

## Quick Start

Let's start with the simplest possible example. Just copy this, run it, and you'll see Runner in action:

```bash
npm install @bluelibs/runner
```

```typescript
import { r, run } from "@bluelibs/runner";

// Step 1: Create a simple task (just a function with a name)
const greet = r
  .task("greet")
  .run(async (name: string) => `Hello, ${name}!`)
  .build();

// Step 2: Put it in an app resource (where you register components)
const app = r
  .resource("app")
  .register([greet]) // Tell the app about your task
  .build();

// Step 3: Run it!
const { runTask, dispose } = await run(app);

// Step 4: Use your task
const message = await runTask(greet, "World");
console.log(message); // "Hello, World!"

// Step 5: Clean up when done (idempotent -- safe to call twice)
await dispose();
```

That's it! You just:

1.  Created a task
2.  Registered it
3.  Ran it
4.  Cleaned up

**What you should see:**

```
Hello, World!
```

**What you just learned**: The basic Runner pattern: Define -> Register -> Run -> Execute. Everything else builds on this foundation.

**Pro tip**: Pass `{ dryRun: true }` to `run()` to validate your wiring without starting anything -- great for CI pipelines.

**Next step**: See how this scales to real apps below.

### Building a Real Express Server

Now that you've seen the basics, let's build something real. Here's a complete Express API server with dependency injection, logging, and lifecycle management. The example keeps all wiring in one place so you can trace setup and teardown.

```bash
npm install @bluelibs/runner express zod
```

```typescript
import express from "express";
import { r, run, globals } from "@bluelibs/runner";
import { z } from "zod";

// A resource is anything you want to share across your app, a singleton
const server = r
  .resource<{ port: number }>("app.server")
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

// Tasks are your business logic - easily testable functions
const createUser = r
  .task("app.tasks.createUser")
  .dependencies({ server, logger: globals.resources.logger })
  .inputSchema(z.object({ name: z.string() }))
  .run(async (input, { logger }) => {
    await logger.info(`Creating ${input.name}`);
    return { id: "user-123", name: input.name };
  })
  .build();

// Wire everything together
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

// That's it! Each run is fully isolated
const { runTask, dispose } = await run(app);

// Use the runtime helpers
await runTask(createUser, { name: "Ada" });
await dispose();

// Want to see what's happening? Add debug logging:
// await run(app, { debug: "verbose" });
```

**What you should see:**

```
Server running on port 3000
Creating Ada
{ id: 'user-123', name: 'Ada' }
```

**What you just built:**

- A full Express API with proper lifecycle management
- Dependency injection (tasks get what they need automatically)
- Built-in logging (via `globals.resources.logger`)
- Schema validation with Zod
- Graceful shutdown (the `dispose()` method -- idempotent, safe to call twice)
- Type-safe everything (TypeScript has your back)

**Note**: See how we used `r.task()` and `r.resource()`? That's the **fluent builder API** -- the recommended way to build with Runner. It's chainable, type-safe, and reads like a story.

> **runtime:** "An Express server with DI, validation, logging, and graceful shutdown. And you didn't write a single decorator. I'm almost proud."

### Classic API (still supported)

Prefer fluent builders for new code, but the classic `define`-style API remains supported and can be mixed in the same app:

```ts
import { resource, task, run } from "@bluelibs/runner";

const db = resource({ id: "app.db", init: async () => "conn" });
const add = task({
  id: "app.tasks.add",
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
- [HTTP Tunnels](./readmes/TUNNELS.md) - Remote task execution

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

### Pattern 6: Built-in Globals

Runner provides commonly-used resources and middleware out of the box:

```typescript
import { globals } from "@bluelibs/runner";

const myTask = r
  .task("myTask")
  .dependencies({ logger: globals.resources.logger }) // Built-in logger
  .middleware([globals.middleware.task.cache.with({ ttl: 60000 })]) // Built-in cache
  .run(async (input, { logger }) => {
    await logger.info("Processing...");
  })
  .build();
```

See [Quick Wins](#quick-wins-copy-paste-solutions) for ready-to-use examples with globals.

### Pattern 7: Typed Errors

Runner provides a fluent error builder so your errors are typed, namespaced, and inspectable:

```typescript
import { r } from "@bluelibs/runner";

// Define a typed error
const InvalidCredentials = r
  .error<{ email: string }>("app.errors.InvalidCredentials")
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
    console.log(err.id); // "app.errors.InvalidCredentials"
  }
}
```

See [Errors](#errors) for `throws` contracts, `store.getAllThrows()`, and advanced patterns.

---

**Key takeaway**: Define -> Register -> Run -> Execute. That's the rhythm of every Runner application.

### What's Next?

Now that you know the patterns, here's your learning path:

1. **[Quick Wins](#quick-wins-copy-paste-solutions)** - Copy-paste solutions for caching, retry, timeouts
2. **[The Big Five](#the-big-five)** - Deep dive into Tasks, Resources, Events, Middleware, Tags
3. **[Events & Hooks](#events)** - Decouple your app with event-driven patterns
4. **[Middleware](#middleware)** - Add cross-cutting concerns cleanly
5. **[Testing](#testing)** - Unit tests, integration tests, overrides, and isolation
6. **[Troubleshooting](#troubleshooting)** - Common issues and how to fix them

> **runtime:** "Seven patterns. That's it. You just learned what takes most developers three debugging sessions and a Stack Overflow rabbit hole to figure out. The other 10% of midnight emergencies? That's why I log everything."

---
