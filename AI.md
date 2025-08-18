# BlueLibs Runner: Complete Framework Guide

## Installation

```bash
npm install @bluelibs/runner
```

## Quick Start

```ts
import express from "express";
import { resource, task, run } from "@bluelibs/runner";

const server = resource({
  id: "app.server",
  init: async (config: { port: number }) => {
    const app = express();
    const server = app.listen(config.port);
    console.log(`Server running on port ${config.port}`);
    return { app, server };
  },
  dispose: async ({ server }) => server.close(),
});

const createUser = task({
  id: "app.tasks.createUser",
  dependencies: { server },
  run: async (userData: { name: string }, { server }) => {
    return { id: "user-123", ...userData };
  },
});

const app = resource({
  register: [server.with({ port: 3000 }), createUser],
  dependencies: { server, createUser },
  init: async (_, { server, createUser }) => {
    server.app.post("/users", async (req, res) => {
      const user = await createUser(req.body);
      res.json(user);
    });
  },
});

const { dispose } = await run(app);
```

## Core Philosophy

TypeScript-first framework with explicit dependencies, functional programming principles, and zero magic. Everything is async, tasks are functions, resources are singletons, events enable loose coupling. All functions are imported from "@bluelibs/runner".

## The Big Four (TERM)

### 1. Tasks - Business Logic Functions

```ts
const createUser = task({
  id: "app.tasks.createUser",
  dependencies: { userService, userRegistered },
  inputSchema: userSchema, // Optional validation
  middleware: [authMiddleware.with({ role: "admin" })],
  run: async (userData, { userService, userRegistered }) => {
    const user = await userService.createUser(userData);
    await userRegistered({ userId: user.id, email: user.email });
    return user;
  },
});

// Event listeners
const emailTask = task({
  // Same as task but
  id: "app.tasks.sendWelcomeEmail",
  on: userRegistered, // Listen to events
  run: async (event, deps) => {
    console.log(`Welcome email to ${event.data.email}`);
  },
});
```

**When to use tasks:**

- High-level business actions
- Need dependency injection
- Want observability/tracking
- Multiple parts of app need it

**Don't make tasks for:** Simple utils, single-use functions, performance-critical code

### 2. Resources - Managed Singletons

```ts
const database = resource({
  id: "app.db",
  configSchema: dbConfigSchema, // Validates on .with()
  context: () => ({
    connections: new Map(),
    pools: [],
    metrics: { queries: 0 },
  }), // Private context shared between init/dispose
  init: async (config, deps, ctx) => {
    const db = await connectToDatabase(config.url);
    ctx.connections.set("main", db);
    ctx.pools.push(createPool(db));

    // Setup query tracking using private context
    const originalQuery = db.query;
    db.query = (...args) => {
      ctx.metrics.queries++;
      return originalQuery.apply(db, args);
    };

    return db;
  },
  dispose: async (db, config, deps, ctx) => {
    console.log(`Total queries executed: ${ctx.metrics.queries}`);

    // Clean up all pools tracked in context
    for (const pool of ctx.pools) {
      await pool.drain();
    }

    // Close all connections tracked in context
    for (const [name, conn] of ctx.connections) {
      await conn.close();
    }
  },
});

// Configuration with type safety
const app = resource({
  register: [
    database.with({ url: "postgres://localhost" }), // .with() required if config needed
    userService,
  ],
});
```

**Resource Configuration:**

```ts
// Type-safe configuration with .with()
const emailer = resource({
  id: "app.emailer",
  init: async (config: { smtpUrl: string; from: string }) => ({
    send: async (to: string, subject: string, body: string) => {
      // Use config.smtpUrl and config.from
    },
  }),
});

const app = resource({
  register: [
    emailer.with({
      smtpUrl: "smtp://localhost",
      from: "noreply@myapp.com",
    }),
  ],
});
```

**Private Context Use Cases:**

- Connection pools and cleanup tracking
- Metrics collection between init/dispose
- Temporary resources that need coordinated cleanup
- State that doesn't belong in the main return value

### 3. Events - Decoupled Communication

```ts
const userRegistered = event<{ userId: string; email: string }>({
  id: "app.events.userRegistered",
  payloadSchema: userEventSchema, // Validates on emit
});

// Emit events
await userRegistered({ userId: "123", email: "user@example.com" });

// Stop propagation
const emergencyHandler = task({
  on: criticalAlert,
  listenerOrder: -100, // Higher priority, default 0.
  run: async (event) => {
    if (event.data.severity === "critical") {
      event.stopPropagation(); // Stops other listeners
    }
  },
});

// Global event listeners
const taskLogger = task({
  on: "*", // Listen to everything
  run: (event) => console.log("Event:", event.id),
});
```

### 4. Middleware - Cross-Cutting Concerns

```ts
const authMiddleware = middleware({
  id: "app.middleware.auth",
  configSchema: authConfigSchema, // Validates on .with() in registration phase
  run: async ({ task, next }, deps, config) => {
    // task.definition
    const user = task.input.user;
    if (!user || user.role !== config.requiredRole) {
      throw new Error("Unauthorized");
    }
    return next(task.input);
  },
});

// Apply globally
const app = resource({
  register: [authMiddleware.everywhere({ tasks: true, resources: false })],
});
```

## Advanced Features

### Context & Validation & Built-in Middleware

```ts
import { z } from "zod";
import { globals, createContext } from "@bluelibs/runner";

// Context for request-scoped data
const UserContext = createContext<{ userId: string; requestId: string }>(
  "user",
);

// Validation schemas
const userSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
});

// Task with all built-in middleware + context + validation
const processUser = task({
  id: "app.tasks.processUser",
  inputSchema: userSchema, // Validates input with any library implementing parse(): T
  dependencies: { logger: globals.resources.logger },
  middleware: [
    UserContext.require(), // Ensures context exists
    globals.middleware.cache.with({
      ttl: 60000,
      keyBuilder: (taskId, input) => `${taskId}-${input.email}`,
    }),
    globals.middleware.retry.with({
      retries: 3,
      delayStrategy: (attempt) => 100 * Math.pow(2, attempt),
      stopRetryIf: (error) => error.message === "Invalid user", // Don't retry validation errors
    }),
  ],
  run: async (userData, { logger }) => {
    const context = UserContext.use(); // Available in async chain
    const contextLogger = logger.with({ requestId: context.requestId });

    contextLogger.info("Processing user", { data: { email: userData.email } });
    // Expensive operation that gets cached and retried on failure
    return await processUserData(userData);
  },
});

// App setup with all global resources
const app = resource({
  register: [
    // Cache resource (required for cache middleware)
    globals.resources.cache.with({
      defaultOptions: { max: 1000, ttl: 30000 },
    }),
    // Logger resource (available by default)
    processUser,
  ],
  dependencies: { processUser },
  init: async (_, { processUser }) => {
    // Provide context and run task
    return UserContext.provide(
      { userId: "123", requestId: "abc-123" },
      async () => processUser({ name: "John", email: "john@example.com" }),
    );
  },
});

// Event-driven log shipping
const logShipper = resource({
  id: "app.logShipper",
  run: async (_, { logger }) => {
    logger.onLog(async (log) => {
      // Do something with the log.
    });
  },
});
```

**Global Middleware Example:**

```ts
const apiTask = task({
  middleware: [
    globals.middleware.cache.with({ ttl: 300000 }),
    globals.middleware.retry.with({ retries: 3 }),
    globals.middleware.timeout.with({ ttl: 10000 }), // 10 second timeout
  ],
  run: async (input) => await expensiveApiCall(input),
});
```

**Built-ins:** `cache` (LRU/TTL), `retry` (exponential backoff), `timeout` (AbortController-based), custom context via `createContext().require()`

**Environment Controls:**

```bash
RUNNER_LOG_LEVEL=debug          # trace|debug|info|warn|error|critical
RUNNER_DISABLE_LOGS=true        # Disable auto-printing
```

### Metadata & Tags

```ts
const performanceTag = tag<{ alertAboveMs: number }>({ id: "performance" });
const rateLimitTag = tag<{ maxRequestsPerMin: number }>({ id: "rate.limit" });
const userContract = tag<void, { name: string }>({ id: "contract.user" });

const createUserTask = task({
  meta: {
    title: "Create User",
    description: "Creates new user account with validation",
    tags: [
      "api",
      "user-management",
      performanceTag.with({ alertAboveMs: 1000 }),
      rateLimitTag.with({ maxRequestsPerMin: 100 }),
      userContract, // Enforces return type { name: string }
    ],
  },
  run: async () => ({ name: "John" }), // Must return object with name
});

// Tag extraction and usage
const perfMiddleware = middleware({
  run: async ({ task, next }) => {
    const perfConfig = performanceTag.extract(task.definition);
    if (perfConfig) {
      const start = Date.now();
      const result = await next();
      const duration = Date.now() - start;
      if (duration > perfConfig.config.alertAboveMs) {
        console.warn(`Slow task: ${duration}ms`);
      }
      return result;
    }
    return next();
  },
});

// Using store to find components by tags
const apiSetup = task({
  id: "app.setup.api",
  dependencies: { store: globals.resources.store },
  run: async (_, { store }) => {
    // Find all API tasks
    const apiTasks = store.getTasksWithTag("api");

    // Find all performance-monitored tasks
    const perfTasks = store.getTasksWithTag(performanceTag);

    // Find all resources with specific tags
    const cacheResources = store.getResourcesWithTag("cache");

    // Setup routes/monitoring based on discovered components
    apiTasks.forEach((taskDef) => {
      const rateLimit = rateLimitTag.extract(taskDef);
      if (rateLimit) {
        setupRateLimit(taskDef.id, rateLimit.config.maxRequestsPerMin);
      }
    });
  },
});
```

**⚠️ Tag Performance:** Avoid tag extraction in global middleware (runs on every execution). Use one-time setup listening to `globals.events.afterInit` instead.

### Concurrency Control

```ts
import { Semaphore, Queue } from "@bluelibs/runner";

const dbSemaphore = new Semaphore(5); // Max 5 concurrent
const result = await dbSemaphore.withPermit(
  async () => await db.query("SELECT * FROM users"),
  { timeout: 5000 },
);

const queue = new Queue();
const result = await queue.run(async (signal) => {
  // Cooperative cancellation
  if (signal.aborted) throw new Error("Cancelled");
  return await processData();
});
await queue.dispose({ cancel: true }); // Cancel pending tasks
```

### Organization & Overrides

```ts
// Index pattern - group dependencies
const services = index({ userService, emailService, paymentService });

// Namespacing: {domain}.{type}.{name}
const userTasks = {
  create: task({ id: "app.tasks.user.create" /* ... */ }),
  onRegistered: task({
    id: "app.tasks.user.onRegistered",
    on: userRegistered /* ... */,
  }),
};

// Anonymous IDs - omit id for auto Symbol based on file path
const emailService = resource({
  // Generated: Symbol('services.email.resource')
  init: async () => new EmailService(),
});
```

## Overrides

```ts
import { override } from "@bluelibs/runner";

// Swap components for testing/environments
const productionEmailer = resource({
  id: "app.emailer",
  init: async () => new SMTPEmailer(),
});

const testEmailer = override(productionEmailer, {
  init: async () => new MockEmailer(),
});

const app = resource({
  register: [productionEmailer],
  overrides: [testEmailer], // Replaces production version
});
```

### Testing

```ts
// Test harness - run full app with overrides
const harness = createTestResource(app, {
  overrides: [mockDatabase, mockEmailService],
});

const { value: testRunner, dispose } = await run(harness);
const result = await testRunner.runTask(createUser, { name: "Test" });
await dispose();
```

## Events & Error Handling

```ts
// Built-in lifecycle events
const errorHandler = task({
  on: myTask.events.onError, // Also: beforeRun, afterRun
  run: async (event) => {
    console.error("Task failed:", event.data.error);
    event.data.suppress(); // Prevents error bubbling
  },
});

// Global events: globals.tasks.beforeRun, globals.resources.afterInit, globals.events.log
```

## Quick Reference

**API Signatures:**

```ts
task({ id, meta, dependencies, inputSchema, middleware, on, run });
resource({
  id,
  meta,
  register,
  dependencies,
  configSchema,
  context,
  init,
  dispose,
});
event({ id, payloadSchema });
middleware({ id, configSchema, run }).everywhere({ tasks, resources });
```

**Core Patterns:**

- Tasks: Business logic functions with DI
- Resources: Managed singletons with lifecycle
- Events: Decoupled async communication
- Middleware: Cross-cutting concerns
- Context: Request-scoped data via `createContext()`
- Tags: Metadata for discovery and behavior
- Overrides: Replace components while preserving ID

**Built-ins:**

- `globals.middleware.cache/retry/timeout` - Caching, resilience, and timeouts
- `globals.resources.logger` - Structured logging with events
- `globals.resources.store` - Component discovery via tags
- Anonymous IDs via Symbol generation from file paths

**Environment:**

```bash
RUNNER_LOG_LEVEL=debug|info|warn|error|critical
RUNNER_DISABLE_LOGS=true
```

## Validation

```ts
import { z } from "zod";

const userSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
});

// Task input validation
const createUser = task({
  inputSchema: userSchema,
  run: async (userData) => {
    // userData is validated and typed
    return { id: "user-123", ...userData };
  },
});

// Resource config validation (fail fast on .with())
const database = resource({
  configSchema: z.object({ url: z.string().url() }),
  init: async (config) => connectToDb(config.url),
});

// Event payload validation
const userEvent = event({
  payloadSchema: z.object({ userId: z.string() }),
});
```

## Testing

```ts
import { run, createTestResource, override } from "@bluelibs/runner";

// Unit testing - mock dependencies
describe("createUser task", () => {
  it("should create user", async () => {
    const mockService = { create: jest.fn().mockResolvedValue({ id: "123" }) };
    const result = await createUser.run(
      { name: "John" },
      { userService: mockService },
    );
    expect(result.id).toBe("123");
  });
});

// Integration testing - run full app with overrides
const testDb = override(database, { init: async () => new InMemoryDb() });
const harness = createTestResource(app, { overrides: [testDb] });

const { value: testRunner, dispose } = await run(harness);
const result = await testRunner.runTask(createUser, { name: "Test" });
await dispose();
```

## Concurrency

```ts
import { Semaphore, Queue } from "@bluelibs/runner";

// Semaphore - limit concurrent operations
const dbSemaphore = new Semaphore(5);
const result = await dbSemaphore.withPermit(
  async () => await db.query("SELECT * FROM users"),
  { timeout: 5000 },
);

// Queue - FIFO with cancellation support
const queue = new Queue();
const result = await queue.run(async (signal) => {
  if (signal.aborted) throw new Error("Cancelled");
  return await processData();
});
await queue.dispose({ cancel: true });
```
