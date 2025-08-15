# BlueLibs Runner

_Or: How I Learned to Stop Worrying and Love Dependency Injection_

<p align="center">
<a href="https://github.com/bluelibs/runner/actions/workflows/ci.yml"><img src="https://github.com/bluelibs/runner/actions/workflows/ci.yml/badge.svg?branch=main" alt="Build Status" /></a>
<a href="https://github.com/bluelibs/runner"><img src="https://img.shields.io/badge/coverage-100%25-brightgreen" alt="Coverage 100% is enforced. Code does not build without 100% on all branches, lines, etc." /></a>
<a href="https://bluelibs.github.io/runner/" target="_blank"><img src="https://img.shields.io/badge/read-typedocs-blue" alt="Docs" /></a>
<a href="https://github.com/bluelibs/runner" target="_blank"><img src="https://img.shields.io/badge/github-blue" alt="GitHub" /></a>
</p>

- [View the documentation page here](https://bluelibs.github.io/runner/)
- [Express + OpenAPI + SQLite Example](https://github.com/bluelibs/runner/tree/main/examples/express-openapi-sqlite)

Welcome to BlueLibs Runner, where we've taken the chaos of modern application architecture and turned it into something that won't make you question your life choices at 3am. This isn't just another framework – it's your new best friend who actually understands that code should be readable, testable, and not require a PhD in abstract nonsense to maintain.

## What Is This Thing?

BlueLibs Runner is a TypeScript-first framework that embraces functional programming principles while keeping dependency injection simple enough that you won't need a flowchart to understand your own code. Think of it as the anti-framework framework – it gets out of your way and lets you build stuff that actually works.

### The Core

- **Tasks are functions** - Not classes with 47 methods you'll never use
- **Resources are singletons** - Database connections, configs, services - the usual suspects
- **Events are just events** - Revolutionary concept, we know
- **Everything is async** - Because it's 2025 and blocking code is so 2005
- **Explicit beats implicit** - No magic, no surprises, no "how the hell does this work?"

## Quick Start

```bash
npm install @bluelibs/runner
```

Here's a complete Express server in less lines than most frameworks need for their "Hello World":

```typescript
import express from "express";
import { resource, task, run } from "@bluelibs/runner";

// A resource is anything you want to share across your app
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

// Tasks are your business logic - pure-ish, easily testable functions
const createUser = task({
  id: "app.tasks.createUser",
  dependencies: { server },
  run: async (userData: { name: string }, { server }) => {
    // Your actual business logic here
    return { id: "user-123", ...userData };
  },
});

// Wire everything together
const app = resource({
  id: "app",
  // Here you make the system aware of resources, tasks, middleware, and events.
  register: [server.with({ port: 3000 }), createUser],
  dependencies: { server, createUser },
  init: async (_, { server, createUser }) => {
    server.app.post("/users", async (req, res) => {
      const user = await createUser(req.body);
      res.json(user);
    });
  },
});

// That's it. No webpack configs, no decorators, no XML.
const { dispose } = await run(app);
```

## The Big Four

Another term to define them would be TERM. (tasks, events, resources, middleware)

### Tasks

Tasks are functions with superpowers. They're pure-ish, testable, and composable. Unlike classes that accumulate methods like a hoarder accumulates stuff, tasks do one thing well.

```typescript
const sendEmail = task({
  id: "app.tasks.sendEmail",
  dependencies: { emailService, logger },
  run: async ({ to, subject, body }: EmailData, { emailService, logger }) => {
    await logger.info(`Sending email to ${to}`);
    return await emailService.send({ to, subject, body });
  },
});

// Test it like a normal function (because it basically is)
const result = await sendEmail.run(
  { to: "user@example.com", subject: "Hi", body: "Hello!" },
  { emailService: mockEmailService, logger: mockLogger }
);
```

Look, we get it. You could turn every function into a task, but that's like using a sledgehammer to crack nuts. Here's the deal:

**Make it a task when:**

- It's a high-level business action: `"app.user.register"`, `"app.order.process"`
- You want it trackable and observable
- Multiple parts of your app need it
- It's complex enough to benefit from dependency injection

**Don't make it a task when:**

- It's a simple utility function
- It's used in only one place or to help other tasks
- It's performance-critical and doesn't need DI overhead

Think of tasks as the "main characters" in your application story, not every single line of dialogue.

### Resources

Resources are the singletons, the services, configs, and connections that live throughout your app's lifecycle. They initialize once and stick around until cleanup time. They have to be registered (via `register: []`) only once before they can be used.

```typescript
const database = resource({
  id: "app.db",
  init: async () => {
    const client = new MongoClient(process.env.DATABASE_URL as string);
    await client.connect();

    return client;
  },
  dispose: async (client) => await client.close(),
});

const userService = resource({
  id: "app.services.user",
  dependencies: { database },
  init: async (_, { database }) => ({
    async createUser(userData: UserData) {
      return database.collection("users").insertOne(userData);
    },
    async getUser(id: string) {
      return database.collection("users").findOne({ _id: id });
    },
  }),
});
```

#### Resource Configuration

Resources can be configured with type-safe options. No more "config object of unknown shape" nonsense.

```typescript
type SMTPConfig = {
  smtpUrl: string;
  from: string;
};

const emailer = resource({
  id: "app.emailer",
  init: async (config: SMTPConfig) => ({
    send: async (to: string, subject: string, body: string) => {
      // Use config.smtpUrl and config.from
    },
  }),
});

// Register with specific config
const app = resource({
  id: "app",
  register: [
    emailer.with({
      smtpUrl: "smtp://localhost",
      from: "noreply@myapp.com",
    }),
    // using emailer without with() will throw a type-error ;)
  ],
});
```

#### Private Context

For cases where you need to share variables between `init()` and `dispose()` methods (because sometimes cleanup is complicated), use the enhanced context pattern:

```typescript
const dbResource = resource({
  id: "db.service",
  context: () => ({
    connections: new Map(),
    pools: [],
  }),
  async init(config, deps, ctx) {
    const db = await connectToDatabase();
    ctx.connections.set("main", db);
    ctx.pools.push(createPool(db));
    return db;
  },
  async dispose(db, config, deps, ctx) {
    // Same context available - no more "how do I access that thing I created?"
    for (const pool of ctx.pools) {
      await pool.drain();
    }
    for (const [name, conn] of ctx.connections) {
      await conn.close();
    }
  },
});
```

### Events

Events let different parts of your app talk to each other without tight coupling. It's like having a really good office messenger who never forgets anything.

```typescript
const userRegistered = event<{ userId: string; email: string }>({
  id: "app.events.userRegistered",
});

const registerUser = task({
  id: "app.tasks.registerUser",
  dependencies: { userService, userRegistered },
  run: async (userData, { userService, userRegistered }) => {
    const user = await userService.createUser(userData);

    // Tell the world about it
    await userRegistered({ userId: user.id, email: user.email });
    return user;
  },
});

// Someone else handles the welcome email
const sendWelcomeEmail = task({
  id: "app.tasks.sendWelcomeEmail",
  on: userRegistered, // Listen to the event, notice the "on"
  run: async (eventData) => {
    // Everything is type-safe, automatically inferred from the 'on' property
    console.log(`Welcome email sent to ${eventData.data.email}`);
  },
});
```

#### Wildcard Events

Sometimes you need to be the nosy neighbor of your application:

```typescript
const logAllEventsTask = task({
  id: "app.tasks.logAllEvents",
  on: "*", // Listen to EVERYTHING
  run(event) {
    console.log("Event detected", event.id, event.data);
    // Note: Be careful with dependencies here since some events fire before initialization
  },
});
```

#### Built-in Events

Tasks and resources have their own lifecycle events that you can hook into:

```typescript
const myTask = task({ ... });
const myResource = resource({ ... });
```

- `myTask.events.beforeRun` - Fires before the task runs
- `myTask.events.afterRun` - Fires after the task completes
- `myTask.events.onError` - Fires when the task fails
- `myResource.events.beforeInit` - Fires before the resource initializes
- `myResource.events.afterInit` - Fires after the resource initializes
- `myResource.events.onError` - Fires when the resource initialization fails

Each event has its own utilities and functions.

#### Global Events

The framework comes with its own set of events that fire during the lifecycle. Think of them as the system's way of keeping you informed:

- `globals.tasks.beforeRun` - "Hey, I'm about to run this task"
- `globals.tasks.afterRun` - "Task completed, here's what happened"
- `globals.tasks.onError` - "Oops, something went wrong"
- `globals.resources.beforeInit` - "Initializing a resource"
- `globals.resources.afterInit` - "Resource is ready"
- `globals.resources.onError` - "Resource initialization failed"

```typescript
const taskLogger = task({
  id: "app.logging.taskLogger",
  on: globalEvents.tasks.beforeRun,
  run(event) {
    console.log(`Running task: ${event.source} with input:`, event.data.input);
  },
});
```

#### stopPropagation()

Sometimes you need to prevent other event listeners from processing an event. The `stopPropagation()` method gives you fine-grained control over event flow:

```typescript
const criticalAlert = event<{
  severity: "low" | "medium" | "high" | "critical";
}>({
  id: "app.events.alert",
  meta: {
    title: "System Alert Event",
    description: "Emitted when system issues are detected",
    tags: ["monitoring", "alerts"],
  },
});

// High-priority handler that can stop propagation
const emergencyHandler = task({
  id: "app.tasks.emergencyHandler",
  on: criticalAlert, // Works with global events too
  listenerOrder: -100, // Higher priority (lower numbers run first)
  run: async (event) => {
    console.log(`Alert received: ${event.data.severity}`);

    if (event.data.severity === "critical") {
      console.log("🚨 CRITICAL ALERT - Activating emergency protocols");

      // Stop other handlers from running
      event.stopPropagation();
      // Notify the on-call team, escalate, etc.

      console.log("🛑 Event propagation stopped - emergency protocols active");
    }
  },
});
```

### Middleware

Middleware wraps around your tasks and resources, adding cross-cutting concerns without polluting your business logic.

```typescript
// This is a middleware that accepts a config
const authMiddleware = middleware({
  id: "app.middleware.auth",
  // You can also add dependencies, no problem.
  run: async (
    { task, next },
    dependencies,
    config: { requiredRole: string }
  ) => {
    const user = task.input.user;
    if (!user || user.role !== config.requiredRole) {
      throw new Error("Unauthorized");
    }
    return next(task.input);
  },
});

const adminTask = task({
  id: "app.tasks.adminOnly",
  // If the configuration accepts {} or is empty, .with() becomes optional, otherwise it becomes enforced.
  middleware: [authMiddleware.with({ requiredRole: "admin" })],
  run: async (input: { user: User }) => {
    return "Secret admin data";
  },
});
```

#### Global Middleware

Want to add logging to everything? Authentication to all tasks? Global middleware has your back:

```typescript
const logMiddleware = middleware({
  id: "app.middleware.log",
  run: async ({ task, next }) => {
    console.log(`Executing: ${task.definition.id}`);
    const result = await next(task.input);
    console.log(`Completed: ${task.definition.id}`);
    return result;
  },
});

const app = resource({
  id: "app",
  register: [
    logMiddleware.everywhere({ tasks: true, resources: false }), // Only tasks get logged

    // For task only, we allow a dynamic filter
    logMiddleware.everywhere({
      tasks(task) {
        // ITask
        // check for tags or etc
        return task?.meta?.tags.includes("test"); // apply it only to tasks that have a tag called 'test'
      },
      // For resources, you do not need such functionality as resources are initiated once when the server boots
      // You can add this logic into your global middleware.
      resources: false,
    }),
  ],
});
```

#### Middleware Dependencies and Limitations

Middleware can have dependencies on resources and other middleware, but certain patterns can create circular dependencies. For detailed information about middleware dependency limitations, best practices, and troubleshooting circular dependencies, see:

**📖 [Middleware Dependencies: Limitations and Best Practices](./MIDDLEWARE-DEPENDENCIES.md)**

Key points:
- Global middleware (`.everywhere()`) dependencies are automatically included in circular dependency analysis
- Avoid middleware depending on resources that use the same middleware
- Use events or extract shared dependencies to resolve circular dependencies
- Function-based dependencies can help with forward references

## Context

Ever tried to pass user data through 15 function calls? Yeah, we've been there. Context fixes that without turning your code into a game of telephone. This is very different from the Private Context from resources.

```typescript
const UserContext = createContext<{ userId: string; role: string }>(
  "app.userContext"
);

const getUserData = task({
  id: "app.tasks.getUserData",
  middleware: [UserContext.require()], // This is a middleware that ensures the context is available before task runs, throws if not.
  run: async () => {
    const user = UserContext.use(); // Available anywhere in the async chain
    return `Current user: ${user.userId} (${user.role})`;
  },
});

// Provide context at the entry point
const handleRequest = resource({
  id: "app.requestHandler",
  init: async () => {
    return UserContext.provide({ userId: "123", role: "admin" }, async () => {
      // All tasks called within this scope have access to UserContext
      return await getUserData();
    });
  },
});
```

### Context with Middleware

Context shines when combined with middleware for request-scoped data:

```typescript
const RequestContext = createContext<{
  requestId: string;
  startTime: number;
  userAgent?: string;
}>("app.requestContext");

const requestMiddleware = middleware({
  id: "app.middleware.request",
  run: async ({ task, next }) => {
    // This works even in express middleware if needed.
    return RequestContext.provide(
      {
        requestId: crypto.randomUUID(),
        startTime: Date.now(),
        userAgent: "MyApp/1.0",
      },
      async () => {
        return next(task.input);
      }
    );
  },
});

const handleRequest = task({
  id: "app.handleRequest",
  middleware: [requestMiddleware],
  run: async (input: { path: string }) => {
    const request = RequestContext.use();
    console.log(`Processing ${input.path} (Request ID: ${request.requestId})`);
    return { success: true, requestId: request.requestId };
  },
});
```

## The Index Pattern

When your app grows beyond "hello world", you'll want to group related dependencies. The `index()` helper is your friend - it's basically a 3-in-1 resource that registers, depends on, and returns everything you give it.

```typescript
// This registers all services, depends on them, and returns them as one clean interface
const services = index({
  userService,
  emailService,
  paymentService,
  notificationService,
});

const app = resource({
  id: "app",
  register: [services],
  dependencies: { services },
  init: async (_, { services }) => {
    // Access everything through one clean interface
    const user = await services.userService.createUser(userData);
    await services.emailService.sendWelcome(user.email);
  },
});
```

## Error Handling

Errors happen. When they do, you can listen for them and decide what to do. No more unhandled promise rejections ruining your day.

```typescript
const riskyTask = task({
  id: "app.tasks.risky",
  run: async () => {
    throw new Error("Something went wrong");
  },
  // Behind the scenes when you create a task() we create these 3 events for you (onError, beforeRun, afterRun)
});

const errorHandler = task({
  id: "app.tasks.errorHandler",
  on: riskyTask.events.onError,
  run: async (event) => {
    console.error("Task failed:", event.data.error);

    // Don't let the error bubble up - this makes the task return undefined
    event.data.suppress();
  },
});
```

## Caching

Because nobody likes waiting for the same expensive operation twice:

```typescript
import { globals } from "@bluelibs/runner";

const expensiveTask = task({
  id: "app.tasks.expensive",
  middleware: [
    globals.middleware.cache.with({
      // lru-cache options by default
      ttl: 60 * 1000, // Cache for 1 minute
      keyBuilder: (taskId, input) => `${taskId}-${input.userId}`, // optional key builder
    }),
  ],
  run: async ({ userId }) => {
    // This expensive operation will be cached
    return await doExpensiveCalculation(userId);
  },
});

// Global cache configuration
const app = resource({
  id: "app.cache",
  register: [
    // You have to register it, cache resource is not enabled by default.
    globals.resources.cache.with({
      defaultOptions: {
        max: 1000, // Maximum items in cache
        ttl: 30 * 1000, // Default TTL
      },
      async: false, // in-memory is sync by default
      // When using redis or others mark this as true to await response.
    }),
  ],
});
```

Want Redis instead of the default LRU cache? No problem, just override the cache factory task:

```typescript
import { task } from "@bluelibs/runner";

const redisCacheFactory = task({
  id: "globals.tasks.cacheFactory", // Same ID as the default task
  run: async (options: any) => {
    return new RedisCache(options); // Make sure to turn async on in the cacher.
  },
});

const app = resource({
  id: "app",
  register: [
    // Your other stuff
  ],
  overrides: [redisCacheFactory], // Override the default cache factory
});
```

## Performance

BlueLibs Runner is designed with performance in mind. The framework introduces minimal overhead while providing powerful features like dependency injection, middleware, and event handling.

Test it yourself by cloning @bluelibs/runner and running `npm run benchmark`.

You may see negative middlewareOverheadMs. This is a measurement artifact at micro-benchmark scale: JIT warm‑up, CPU scheduling, GC timing, and cache effects can make the “with middleware” run appear slightly faster than the baseline. Interpret small negatives as ≈ 0 overhead.

### Performance Benchmarks

Here are real performance metrics from our comprehensive benchmark suite on an M1 Max.

#### Core Operations

- **Basic task execution**: ~270,000 tasks/sec to ~350,000 tasks/sec
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
const userTask = task({
  id: "user.create",
  middleware: [auth, logging, metrics],
  run: async (userData) => {
    return database.users.create(userData);
  },
});

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
const task = defineTask({
  middleware: [
    fastAuthCheck, // ~0.1ms
    slowRateLimiting, // ~2ms
    expensiveLogging, // ~5ms
  ],
});
```

**Resource Reuse**: Resources are singletons—perfect for expensive setup

```typescript
const database = resource({
  init: async () => {
    // Expensive connection setup happens once
    const connection = await createDbConnection();
    return connection;
  },
});
```

**Cache Strategically**: Use built-in caching for expensive operations

```typescript
const expensiveTask = task({
  middleware: [globals.middlewares.cache.with({ ttl: 60000 })],
  run: async (input) => {
    // This expensive computation is cached
    return performExpensiveCalculation(input);
  },
});
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
  `Throughput: ${Math.round(iterations / (duration / 1000))} tasks/sec`
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
| Built-in Caching     | 1.8x speedup         | Automatic optimization        |

**Bottom line**: The framework adds minimal overhead (~0.005ms per task) while providing significant architectural benefits.

## Retrying Failed Operations

For when things go wrong, but you know they'll probably work if you just try again. The built-in retry middleware makes your tasks and resources more resilient to transient failures.

```typescript
import { globals } from "@bluelibs/runner";

const flakyApiCall = task({
  id: "app.tasks.flakyApiCall",
  middleware: [
    globals.middleware.retry.with({
      retries: 5, // Try up to 5 times
      delayStrategy: (attempt) => 100 * Math.pow(2, attempt), // Exponential backoff
      stopRetryIf: (error) => error.message === "Invalid credentials", // Don't retry auth errors
    }),
  ],
  run: async () => {
    // This might fail due to network issues, rate limiting, etc.
    return await fetchFromUnreliableService();
  },
});

const app = resource({
  id: "app",
  register: [flakyApiCall],
});
```

The retry middleware can be configured with:

- `retries`: The maximum number of retry attempts (default: 3).
- `delayStrategy`: A function that returns the delay in milliseconds before the next attempt.
- `stopRetryIf`: A function to prevent retries for certain types of errors.

## Timeouts

The built-in timeout middleware prevents operations from hanging indefinitely by racing them against a configurable
timeout. Works for resources and tasks.

```typescript
import { globals } from "@bluelibs/runner";

const apiTask = task({
  id: "app.tasks.externalApi",
  middleware: [
    globals.middleware.timeout.with({ ttl: 5000 }), // 5 second timeout
  ],
  run: async () => {
    // This operation will be aborted if it takes longer than 5 seconds
    return await fetch("https://slow-api.example.com/data");
  },
});

// Combine with retry for robust error handling
const resilientTask = task({
  id: "app.tasks.resilient",
  middleware: [
    // Order matters here. Imagine a big onion.
    globals.middleware.retry.with({
      retries: 3,
      delayStrategy: (attempt) => 1000 * attempt, // 1s, 2s, 3s delays
    }),
    globals.middleware.timeout.with({ ttl: 10000 }), // 10 second timeout per attempt
  ],
  run: async () => {
    // Each retry attempt gets its own 10-second timeout
    return await unreliableOperation();
  },
});
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

## Logging

_The structured logging system that actually makes debugging enjoyable_

BlueLibs Runner comes with a built-in logging system that's event-driven, structured, and doesn't make you hate your life when you're trying to debug at 2 AM. It emits events for everything, so you can handle logs however you want - ship them to your favorite log warehouse, pretty-print them to console, or ignore them entirely (we won't judge).

### Basic Logging

```typescript
import { globals } from "@bluelibs/runner";

const businessTask = task({
  id: "app.tasks.business",
  dependencies: { logger: globals.resources.logger },
  run: async (_, { logger }) => {
    logger.info("Starting business process"); // ✅ Visible by default
    logger.warn("This might take a while"); // ✅ Visible by default
    logger.error("Oops, something went wrong", {
      // ✅ Visible by default
      error: new Error("Database connection failed"),
    });
    logger.critical("System is on fire", {
      // ✅ Visible by default
      data: { temperature: "9000°C" },
    });
    logger.debug("Debug information"); // ❌ Hidden by default
    logger.trace("Very detailed trace"); // ❌ Hidden by default
  },
});
```

**Good news!** Logs at `info` level and above are visible by default, so you'll see your application logs immediately without any configuration. For development and debugging, you can easily show more detailed logs:

```bash
# Show debug logs and framework internals
RUNNER_LOG_LEVEL=debug node your-app.js

# Hide all logs for production
RUNNER_DISABLE_LOGS=true node your-app.js
```

### Log Levels

The logger supports six log levels with increasing severity:

| Level      | Severity | When to Use                                 | Color   |
| ---------- | -------- | ------------------------------------------- | ------- |
| `trace`    | 0        | Ultra-detailed debugging info               | Gray    |
| `debug`    | 1        | Development and debugging information       | Cyan    |
| `info`     | 2        | General information about normal operations | Green   |
| `warn`     | 3        | Something's not right, but still working    | Yellow  |
| `error`    | 4        | Errors that need attention                  | Red     |
| `critical` | 5        | System-threatening issues                   | Magenta |

```typescript
// All log levels are available as methods
logger.trace("Ultra-detailed debugging info");
logger.debug("Development debugging");
logger.info("Normal operation");
logger.warn("Something's fishy");
logger.error("Houston, we have a problem");
logger.critical("DEFCON 1: Everything is broken");
```

### Structured Logging

The logger accepts rich, structured data that makes debugging actually useful:

```typescript
const userTask = task({
  id: "app.tasks.user.create",
  dependencies: { logger: globals.resources.logger },
  run: async (userData, { logger }) => {
    // Basic message
    logger.info("Creating new user");

    // With structured data
    logger.info("User creation attempt", {
      data: {
        email: userData.email,
        registrationSource: "web",
        timestamp: new Date().toISOString(),
      },
    });

    // With error information
    try {
      const user = await createUser(userData);
      logger.info("User created successfully", {
        data: { userId: user.id, email: user.email },
      });
    } catch (error) {
      logger.error("User creation failed", {
        error,
        data: {
          attemptedEmail: userData.email,
          validationErrors: error.validationErrors,
        },
      });
    }
  },
});
```

### Context-Aware Logging

Create logger instances with bound context for consistent metadata across related operations:

```typescript
const RequestContext = createContext<{ requestId: string; userId: string }>(
  "app.requestContext"
);

const requestHandler = task({
  id: "app.tasks.handleRequest",
  dependencies: { logger: globals.resources.logger },
  run: async (requestData, { logger }) => {
    const request = RequestContext.use();

    // Create a contextual logger with bound metadata
    const requestLogger = logger.with({
      requestId: request.requestId,
      userId: request.userId,
      source: "api.handler",
    });

    // All logs from this logger will include the bound context
    requestLogger.info("Processing request", {
      data: { endpoint: requestData.path },
    });

    requestLogger.debug("Validating input", {
      data: { inputSize: JSON.stringify(requestData).length },
    });

    // Context is automatically included in all log events
    requestLogger.error("Request processing failed", {
      error: new Error("Invalid input"),
      data: { stage: "validation" },
    });
  },
});
```

### Print Threshold

By default, logs at `info` level and above are automatically printed to console for better developer experience. You can easily control this behavior through environment variables or by setting a print threshold programmatically:

### Environment Variables

```bash
# Disable all logging output
RUNNER_DISABLE_LOGS=true node your-app.js

# Set specific log level (trace, debug, info, warn, error, critical)
RUNNER_LOG_LEVEL=debug node your-app.js
RUNNER_LOG_LEVEL=error node your-app.js
```

### Programmatic Control

```typescript
// Override the default print threshold programmatically
const setupLogging = task({
  id: "app.logging.setup",
  on: globals.resources.logger.events.afterInit,
  run: async (event) => {
    const logger = event.data.value;

    // Print debug level and above (debug, info, warn, error, critical)
    logger.setPrintThreshold("debug");

    // Print only errors and critical issues
    logger.setPrintThreshold("error");

    // Disable auto-printing entirely
    logger.setPrintThreshold(null);
  },
});
```

### Event-Driven Log Handling

Every log generates an event that you can listen to. This is where the real power comes in:

```typescript
// Ship logs to your favorite log warehouse
const logShipper = task({
  id: "app.logging.shipper", // or pretty printer, or winston, pino bridge, etc.
  on: globals.events.log,
  run: async (event) => {
    const log = event.data;

    // Ship critical errors to PagerDuty
    if (log.level === "critical") {
      await pagerDuty.alert({
        message: log.message,
        details: log.data,
        source: log.source,
      });
    }

    // Ship all errors to error tracking
    if (log.level === "error" || log.level === "critical") {
      await sentry.captureException(log.error || new Error(log.message), {
        tags: { source: log.source },
        extra: log.data,
        level: log.level,
      });
    }

    // Ship everything to your log warehouse
    await logWarehouse.ship({
      timestamp: log.timestamp,
      level: log.level,
      message: log.message,
      source: log.source,
      data: log.data,
      context: log.context,
    });
  },
});

// Filter logs by source
const databaseLogHandler = task({
  id: "app.logging.database",
  on: globals.events.log,
  run: async (event) => {
    const log = event.data;

    // Only handle database-related logs
    if (log.source?.includes("database")) {
      await databaseMonitoring.recordMetric({
        operation: log.data?.operation,
        duration: log.data?.duration,
        level: log.level,
      });
    }
  },
});
```

### Integration with Winston

Want to use Winston as your transport? No problem - integrate it seamlessly:

```typescript
import winston from "winston";

// Create Winston logger, put it in a resource if used from various places.
const winstonLogger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

// Bridge BlueLibs logs to Winston
const winstonBridge = task({
  id: "app.logging.winston",
  on: globals.events.log,
  run: async (event) => {
    const log = event.data;

    // Convert BlueLibs log to Winston format
    const winstonMeta = {
      source: log.source,
      timestamp: log.timestamp,
      data: log.data,
      context: log.context,
      ...(log.error && { error: log.error }),
    };

    // Map log levels (BlueLibs -> Winston)
    const levelMapping = {
      trace: "silly",
      debug: "debug",
      info: "info",
      warn: "warn",
      error: "error",
      critical: "error", // Winston doesn't have critical, use error
    };

    const winstonLevel = levelMapping[log.level] || "info";
    winstonLogger.log(winstonLevel, log.message, winstonMeta);
  },
});
```

### Custom Log Formatters

Want to customize how logs are printed? You can override the print behavior:

```typescript
// Custom logger with JSON output
class JSONLogger extends Logger {
  print(log: ILog) {
    console.log(
      JSON.stringify(
        {
          timestamp: log.timestamp.toISOString(),
          level: log.level.toUpperCase(),
          source: log.source,
          message: log.message,
          data: log.data,
          context: log.context,
          error: log.error,
        },
        null,
        2
      )
    );
  }
}

// Custom logger resource
const customLogger = resource({
  id: "app.logger.custom",
  dependencies: { eventManager: globals.resources.eventManager },
  init: async (_, { eventManager }) => {
    return new JSONLogger(eventManager);
  },
});

// Or you could simply add it as "globals.resources.logger" and override the default logger
```

### Log Structure

Every log event contains:

```typescript
interface ILog {
  level: string; // The log level (trace, debug, info, etc.)
  source?: string; // Where the log came from
  message: any; // The main log message (can be object or string)
  timestamp: Date; // When the log was created
  error?: {
    // Structured error information
    name: string;
    message: string;
    stack?: string;
  };
  data?: Record<string, any>; // Additional structured data, it's about the log itself
  context?: Record<string, any>; // Bound context from logger.with(), it's about the context in which the log was created
}
```

### Debugging Tips & Best Practices

Use Structured Data Liberally

```typescript
// Bad - hard to search and filter
await logger.error(`Failed to process user ${userId} order ${orderId}`);

// Good - searchable and filterable
await logger.error("Order processing failed", {
  data: {
    userId,
    orderId,
    step: "payment",
    paymentMethod: "credit_card",
  },
});
```

Include Context in Errors

```typescript
// Include relevant context with errors
try {
  await processPayment(order);
} catch (error) {
  await logger.error("Payment processing failed", {
    error,
    data: {
      orderId: order.id,
      amount: order.total,
      currency: order.currency,
      paymentMethod: order.paymentMethod,
      attemptNumber: order.paymentAttempts,
    },
  });
}
```

Use Different Log Levels Appropriately

```typescript
// Good level usage
await logger.debug("Cache hit", { data: { key, ttl: remainingTTL } });
await logger.info("User logged in", { data: { userId, loginMethod } });
await logger.warn("Rate limit approaching", {
  data: { current: 95, limit: 100 },
});
await logger.error("Database connection failed", {
  error,
  data: { attempt: 3 },
});
await logger.critical("System out of memory", { data: { available: "0MB" } });
```

Create Domain-Specific Loggers

```typescript
// Create loggers with domain context
const paymentLogger = logger.with({ source: "payment.processor" });
const authLogger = logger.with({ source: "auth.service" });
const emailLogger = logger.with({ source: "email.service" });

// Use throughout your domain
await paymentLogger.info("Processing payment", { data: paymentData });
await authLogger.warn("Failed login attempt", { data: { email, ip } });
```

## Meta

_The structured way to describe what your components do and control their behavior_

Metadata in BlueLibs Runner provides a systematic way to document, categorize, and control the behavior of your tasks, resources, events, and middleware. Think of it as your component's passport - it tells you and your tools everything they need to know about what this component does and how it should be treated.

### Metadata Properties

Every component can have these basic metadata properties:

```typescript
interface IMeta {
  title?: string; // Human-readable name
  description?: string; // What this component does
  tags?: TagType[]; // Categories and behavioral flags
}
```

### Simple Documentation Example

```typescript
const userService = resource({
  id: "app.services.user",
  meta: {
    title: "User Management Service",
    description:
      "Handles user creation, authentication, and profile management",
    tags: ["service", "user", "core"],
  },
  dependencies: { database },
  init: async (_, { database }) => ({
    createUser: async (userData) => {
      /* ... */
    },
    authenticateUser: async (credentials) => {
      /* ... */
    },
  }),
});

const sendWelcomeEmail = task({
  id: "app.tasks.sendWelcomeEmail",
  meta: {
    title: "Send Welcome Email",
    description: "Sends a welcome email to newly registered users",
    tags: ["email", "automation", "user-onboarding"],
  },
  dependencies: { emailService },
  run: async (userData, { emailService }) => {
    // Email sending logic
  },
});
```

### Tags

Tags are the most powerful part of the metadata system used for classification. They can be simple strings or sophisticated configuration objects that control component behavior.

#### String Tags for Simple Classification

```typescript
const adminTask = task({
  id: "app.tasks.admin.deleteUser",
  meta: {
    title: "Delete User Account",
    description: "Permanently removes a user account and all associated data",
    tags: [
      "admin", // Access level
      "destructive", // Behavioral flag
      "user", // Domain
      "gdpr-compliant", // Compliance flag
    ],
  },
  run: async (userId) => {
    // Deletion logic
  },
});

// Middleware that adds extra logging for destructive operations
const auditMiddleware = middleware({
  id: "app.middleware.audit",
  run: async ({ task, next }) => {
    const isDestructive = task.definition.meta?.tags?.includes("destructive");

    if (isDestructive) {
      console.log(`🔥 DESTRUCTIVE OPERATION: ${task.definition.id}`);
      await auditLogger.log({
        operation: task.definition.id,
        user: getCurrentUser(),
        timestamp: new Date(),
      });
    }

    return next(task.input);
  },
});
```

#### Advanced Tags with Configuration

For more sophisticated control, you can create structured tags that carry configuration:

```typescript
import { tag } from "@bluelibs/runner";

// Define a reusable tag with configuration
const performanceTag = tag<{ alertAboveMs: number; criticalAboveMs: number }>({
  id: "performance.monitoring",
});

const rateLimitTag = tag<{ maxRequestsPerMinute: number; burstLimit?: number }>(
  {
    id: "rate.limit",
  }
);

const cacheTag = tag<{ ttl: number; keyPattern?: string }>({
  id: "cache.strategy",
});

// Use structured tags in your components
const expensiveTask = task({
  id: "app.tasks.expensiveCalculation",
  meta: {
    title: "Complex Data Processing",
    description: "Performs heavy computational analysis on large datasets",
    tags: [
      "computation",
      "background",
      performanceTag.with({
        alertAboveMs: 5000,
        criticalAboveMs: 15000,
      }),
      cacheTag.with({
        ttl: 300000, // 5 minutes
        keyPattern: "calc-{userId}-{datasetId}",
      }),
    ],
  },
  run: async (input) => {
    // Heavy computation here
  },
});

const apiEndpoint = task({
  id: "app.tasks.api.getUserProfile",
  meta: {
    title: "Get User Profile",
    description: "Returns user profile information with privacy filtering",
    tags: [
      "api",
      "public",
      rateLimitTag.with({
        maxRequestsPerMinute: 100,
        burstLimit: 20,
      }),
      cacheTag.with({ ttl: 60000 }), // 1 minute cache
    ],
  },
  run: async (userId) => {
    // API logic
  },
});
```

To process these tags you can hook into `globals.events.afterInit`, use the global store as dependency and use the `getTasksWithTag()` and `getResourcesWithTag()` functionality.

#### Structured Tags

```typescript
const performanceMiddleware = middleware({
  id: "app.middleware.performance",
  run: async ({ task, next }) => {
    const tags = task.definition.meta?.tags || [];
    const perfConfigTag = performanceTag.extract(tags); // or easier: .extract(task.definition)

    if (perfConfigTag) {
      const startTime = Date.now();

      try {
        const result = await next(task.input);
        const duration = Date.now() - startTime;

        if (duration > perfConfigTag.config.criticalAboveMs) {
          await alerting.critical(
            `Task ${task.definition.id} took ${duration}ms`
          );
        } else if (duration > perfConfig.config.alertAboveMs) {
          await alerting.warn(`Task ${task.definition.id} took ${duration}ms`);
        }

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        await alerting.error(
          `Task ${task.definition.id} failed after ${duration}ms`,
          error
        );
        throw error;
      }
    }

    return next(task.input);
  },
});
```

#### Contract Tags

You can attach contracts to tags to enforce the shape of a task's returned value and a resource's `init()` value at compile time. Contracts are specified via the second generic of `defineTag<TConfig, TContract>`.

```typescript
// A tag that enforces the returned value to include { name: string }
const userContract = tag<void, { name: string }>({ id: "contract.user" });

// Another tag that enforces { age: number }
const ageContract = tag<void, { age: number }>({ id: "contract.age" });

// Works with configured tags too
const preferenceContract = tag<{ locale: string }, { preferredLocale: string }>(
  { id: "contract.preferences" }
);
```

When these tags are present in `meta.tags`, the returned value must satisfy the intersection of all contract types:

```typescript
// Task: the awaited return value must satisfy { name: string } & { age: number }
const getProfile = task({
  id: "app.tasks.getProfile",
  meta: {
    tags: [
      userContract,
      ageContract,
      preferenceContract.with({ locale: "en" }),
    ],
  },
  run: async () => {
    return { name: "Ada", age: 37, preferredLocale: "en" }; // OK
  },
});

// Resource: init() return must satisfy the same intersection
const profileService = resource({
  id: "app.resources.profileService",
  meta: { tags: [userContract, ageContract] },
  init: async () => {
    return { name: "Ada", age: 37 }; // OK
  },
});
```

If the returned value does not satisfy the intersection, TypeScript surfaces a readable, verbose type error that includes what was expected and what was received.

```typescript
const badTask = task({
  id: "app.tasks.bad",
  meta: { tags: [userContract, ageContract] },
  //    vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv
  run: async () => ({ name: "Ada" }), // Missing { age: number }
  // Type error includes a helpful shape similar to:
  // ContractViolationError<
  //   { message: "Value does not satisfy all tag contracts";
  //     expected: { name: string } & { age: number };
  //     received: { name: string } }
  // >
});
```

### Extending Metadata: Custom Properties

For advanced use cases, you can extend the metadata interfaces to add your own properties:

```typescript
// In your types file
declare module "@bluelibs/runner" {
  interface ITaskMeta {
    author?: string;
    version?: string;
    deprecated?: boolean;
    apiVersion?: "v1" | "v2" | "v3";
    costLevel?: "low" | "medium" | "high";
  }

  interface IResourceMeta {
    healthCheck?: string; // URL for health checking
    dependencies?: string[]; // External service dependencies
    scalingPolicy?: "auto" | "manual";
  }
}

// Now use your custom properties
const expensiveApiTask = task({
  id: "app.tasks.ai.generateImage",
  meta: {
    title: "AI Image Generation",
    description: "Uses OpenAI DALL-E to generate images from text prompts",
    tags: ["ai", "expensive", "external-api"],
    author: "AI Team",
    version: "2.1.0",
    apiVersion: "v2",
    costLevel: "high", // Custom property!
  },
  run: async (prompt) => {
    // AI generation logic
  },
});

const database = resource({
  id: "app.database.primary",
  meta: {
    title: "Primary PostgreSQL Database",
    tags: ["database", "critical", "persistent"],
    healthCheck: "/health/db", // Custom property!
    dependencies: ["postgresql", "connection-pool"],
    scalingPolicy: "auto",
  },
  // ... implementation
});
```

#### Global Middleware Application

```typescript
const app = resource({
  id: "app",
  register: [
    // Apply performance middleware globally but only to tagged tasks
    performanceMiddleware.everywhere({
      tasks: true,
      resources: false,
    }),
    // Apply rate limiting only to API tasks
    rateLimitMiddleware.everywhere({
      tasks: true,
      resources: false,
    }),
  ],
});
```

Metadata transforms your components from anonymous functions into self-documenting, discoverable, and controllable building blocks. Use it wisely, and your future self (and your team) will thank you.

## Advanced Usage: When You Need More Power

## Overrides

Sometimes you need to replace a component entirely. Maybe you're doing integration testing or you want to override a library from an external package.

You can now use a dedicated helper `override()` to safely override any property on tasks, resources, or middleware — except `id`. This ensures the identity is preserved, while allowing behavior changes.

```typescript
const productionEmailer = resource({
  id: "app.emailer",
  init: async () => new SMTPEmailer(),
});

// Option 1: Using override() to change behavior while preserving id (Recommended)
const testEmailer = override(productionEmailer, {
  init: async () => new MockEmailer(),
});

// Option 2: Using spread operator, does not provide type-safety
const testEmailer = resource({
  ...productionEmailer,
  init: async () => {},
});

const app = resource({
  id: "app",
  register: [productionEmailer],
  overrides: [testEmailer], // This replaces the production version
});

import { override } from "@bluelibs/runner";

// Tasks
const originalTask = task({ id: "app.tasks.compute", run: async () => 1 });
const overriddenTask = override(originalTask, {
  run: async () => 2,
});

// Resources
const originalResource = resource({ id: "app.db", init: async () => "conn" });
const overriddenResource = override(originalResource, {
  init: async () => "mock-conn",
});

// Middleware
const originalMiddleware = middleware({
  id: "app.middleware.log",
  run: async ({ next }) => next(),
});
const overriddenMiddleware = override(originalMiddleware, {
  run: async ({ task, next }) => {
    const result = await next(task?.input as any);
    return { wrapped: result } as any;
  },
});
```

Overrides are applied after everything is registered. If multiple overrides target the same id, the one defined higher in the resource tree (closer to the root) wins, because it’s applied last. Conflicting overrides are allowed; overriding something that wasn’t registered throws. Use override() to change behavior safely while preserving the original id.

## Namespacing

As your app grows, you'll want consistent naming. Here's the convention that won't drive you crazy:

| Type           | Format                                    |
| -------------- | ----------------------------------------- |
| Tasks          | `{domain}.tasks.{taskName}`               |
| Listener Tasks | `{domain}.tasks.{taskName}.on{EventName}` |
| Resources      | `{domain}.resources.{resourceName}`       |
| Events         | `{domain}.events.{eventName}`             |
| Middleware     | `{domain}.middleware.{middlewareName}`    |

```typescript
// Helper function for consistency
function namespaced(id: string) {
  return `mycompany.myapp.${id}`;
}

const userTask = task({
  id: namespaced("tasks.user.create"),
  // ...
});
```

## Factory Pattern

To keep things dead simple, we avoided poluting the D.I. with this concept. Therefore, we recommend using a resource with a factory function to create instances of your classes:

```typescript
const myFactory = resource({
  id: "app.factories.myFactory",
  init: async (config: { someOption: string }) => {
    return (input: any) => {
      return new MyClass(input, config.someOption);
    };
  },
});

const app = resource({
  id: "app",
  register: [myFactory],
  dependencies: { myFactory },
  init: async (_, { myFactory }) => {
    const instance = myFactory({ someOption: "value" });
  },
});
```

## Runtime Validation

BlueLibs Runner includes a generic validation interface that works with any validation library, including [Zod](https://zod.dev/), [Yup](https://github.com/jquense/yup), [Joi](https://joi.dev/), and others. The framework provides runtime validation with excellent TypeScript inference while remaining library-agnostic.

The framework defines a simple `IValidationSchema<T>` interface that any validation library can implement:

```typescript
interface IValidationSchema<T> {
  parse(input: unknown): T;
}
```

Popular validation libraries already implement this interface:

- **Zod**: `.parse()` method works directly
- **Yup**: Use `.validateSync()` or create a wrapper
- **Joi**: Use `.assert()` or create a wrapper
- **Custom validators**: Implement the interface yourself

### Task Input Validation

Add an `inputSchema` to any task to validate inputs before execution:

```typescript
import { z } from "zod";
import { task, resource, run } from "@bluelibs/runner";

const userSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  age: z.number().min(0).max(150),
});

const createUserTask = task({
  id: "app.tasks.createUser",
  inputSchema: userSchema, // Works directly with Zod!
  run: async (userData) => {
    // userData is validated and properly typed
    return { id: "user-123", ...userData };
  },
});

const app = resource({
  id: "app",
  register: [createUserTask],
  dependencies: { createUserTask },
  init: async (_, { createUserTask }) => {
    // This works - valid input
    const user = await createUserTask({
      name: "John Doe",
      email: "john@example.com",
      age: 30,
    });

    // This throws a validation error at runtime
    try {
      await createUserTask({
        name: "J", // Too short
        email: "invalid-email", // Invalid format
        age: -5, // Negative age
      });
    } catch (error) {
      console.log(error.message);
      // "Task input validation failed for app.tasks.createUser: ..."
    }
  },
});
```

### Resource Config Validation

Add a `configSchema` to resources to validate configurations. **Validation happens immediately when `.with()` is called**, ensuring configuration errors are caught early:

```typescript
const databaseConfigSchema = z.object({
  host: z.string(),
  port: z.number().min(1).max(65535),
  database: z.string(),
  ssl: z.boolean().default(false), // Optional with default
});

const databaseResource = resource({
  id: "app.resources.database",
  configSchema: databaseConfigSchema, // Validation on .with()
  init: async (config) => {
    // config is already validated and has proper types
    return createConnection({
      host: config.host,
      port: config.port,
      database: config.database,
      ssl: config.ssl,
    });
  },
});

// Validation happens here, not during init!
try {
  const configuredResource = databaseResource.with({
    host: "localhost",
    port: 99999, // Invalid: port too high
    database: "myapp",
  });
} catch (error) {
  // "Resource config validation failed for app.resources.database: ..."
}

const app = resource({
  id: "app",
  register: [
    databaseResource.with({
      host: "localhost",
      port: 5432,
      database: "myapp",
      // ssl defaults to false
    }),
  ],
});
```

### Event Payload Validation

Add a `payloadSchema` to events to validate payloads every time they're emitted:

```typescript
const userActionSchema = z.object({
  userId: z.string().uuid(),
  action: z.enum(["created", "updated", "deleted"]),
  timestamp: z.date().default(() => new Date()),
});

const userActionEvent = event({
  id: "app.events.userAction",
  payloadSchema: userActionSchema, // Validates on emit
});

const notificationTask = task({
  id: "app.tasks.sendNotification",
  on: userActionEvent,
  run: async (eventData) => {
    // eventData.data is validated and properly typed
    console.log(`User ${eventData.data.userId} was ${eventData.data.action}`);
  },
});

const app = resource({
  id: "app",
  register: [userActionEvent, notificationTask],
  dependencies: { userActionEvent },
  init: async (_, { userActionEvent }) => {
    // This works - valid payload
    await userActionEvent({
      userId: "123e4567-e89b-12d3-a456-426614174000",
      action: "created",
    });

    // This throws validation error when emitted
    try {
      await userActionEvent({
        userId: "invalid-uuid",
        action: "unknown",
      });
    } catch (error) {
      // "Event payload validation failed for app.events.userAction: ..."
    }
  },
});
```

### Middleware Config Validation

Add a `configSchema` to middleware to validate configurations. Like resources, **validation happens immediately when `.with()` is called**:

```typescript
const timingConfigSchema = z.object({
  timeout: z.number().positive(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  logSuccessful: z.boolean().default(true),
});

const timingMiddleware = middleware({
  id: "app.middleware.timing",
  configSchema: timingConfigSchema, // Validation on .with()
  run: async ({ next }, _, config) => {
    const start = Date.now();
    try {
      const result = await next();
      const duration = Date.now() - start;
      if (config.logSuccessful && config.logLevel === "debug") {
        console.log(`Operation completed in ${duration}ms`);
      }
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      console.log(`Operation failed after ${duration}ms`);
      throw error;
    }
  },
});

// Validation happens here, not during execution!
try {
  const configuredMiddleware = timingMiddleware.with({
    timeout: -5, // Invalid: negative timeout
    logLevel: "invalid", // Invalid: not in enum
  });
} catch (error) {
  // "Middleware config validation failed for app.middleware.timing: ..."
}

const myTask = task({
  id: "app.tasks.example",
  middleware: [
    timingMiddleware.with({
      timeout: 5000,
      logLevel: "debug",
      logSuccessful: true,
    }),
  ],
  run: async () => "success",
});
```

#### Advanced Validation Features

Any validation library features work with the generic interface. Here's an example with transformations and refinements:

```typescript
const advancedSchema = z
  .object({
    userId: z.string().uuid(),
    amount: z.string().transform((val) => parseFloat(val)), // Transform string to number
    currency: z.enum(["USD", "EUR", "GBP"]),
    metadata: z.record(z.string()).optional(),
  })
  .refine((data) => data.amount > 0, {
    message: "Amount must be positive",
    path: ["amount"],
  });

const paymentTask = task({
  id: "app.tasks.payment",
  inputSchema: advancedSchema,
  run: async (payment) => {
    // payment.amount is now a number (transformed from string)
    // All validations have passed
    return processPayment(payment);
  },
});
```

### Error Handling

Validation errors are thrown with clear, descriptive messages that include the component ID:

```typescript
// Task validation error format:
// "Task input validation failed for {taskId}: {validationErrorMessage}"

// Resource validation error format (thrown on .with() call):
// "Resource config validation failed for {resourceId}: {validationErrorMessage}"

// Event validation error format (thrown on emit):
// "Event payload validation failed for {eventId}: {validationErrorMessage}"

// Middleware validation error format (thrown on .with() call):
// "Middleware config validation failed for {middlewareId}: {validationErrorMessage}"
```

#### Other Libraries

The framework works with any validation library that implements the `IValidationSchema<T>` interface:

```typescript
// Zod (works directly)
import { z } from "zod";
const zodSchema = z.string().email();

// Yup (with wrapper)
import * as yup from "yup";
const yupSchema = {
  parse: (input: unknown) => yup.string().email().validateSync(input),
};

// Joi (with wrapper)
import Joi from "joi";
const joiSchema = {
  parse: (input: unknown) => {
    const { error, value } = Joi.string().email().validate(input);
    if (error) throw error;
    return value;
  },
};

// Custom validation
const customSchema = {
  parse: (input: unknown) => {
    if (typeof input !== "string" || !input.includes("@")) {
      throw new Error("Must be a valid email");
    }
    return input;
  },
};
```

#### When to Use Validation

- **API boundaries**: Validating user inputs from HTTP requests
- **External data**: Processing data from files, databases, or APIs
- **Configuration**: Ensuring environment variables and configs are correct (fail fast)
- **Event payloads**: Validating data in event-driven architectures
- **Middleware configs**: Validating middleware settings at registration time (fail fast)

#### Performance Notes

- Validation only runs when schemas are provided (zero overhead when not used)
- Resource and middleware validation happens once at registration time (`.with()`)
- Task and event validation happens at runtime
- Consider the validation library's performance characteristics for your use case
- All major validation libraries are optimized for runtime validation

#### TypeScript Integration

While runtime validation happens with your chosen library, TypeScript still enforces compile-time types. For the best experience:

```typescript
// With Zod, define your type and schema together

const userSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});

type UserData = z.infer<typeof userSchema>;

const createUser = task({
  inputSchema: userSchema,
  run: async (input: UserData) => {
    // Both runtime validation AND compile-time typing
    return { id: "user-123", ...input };
  },
});
```

## Internal Services

We expose the internal services for advanced use cases (but try not to use them unless you really need to):

```typescript
import { globals } from "@bluelibs/runner";

const advancedTask = task({
  id: "app.advanced",
  dependencies: {
    store: globals.resources.store,
    taskRunner: globals.resources.taskRunner,
    eventManager: globals.resources.eventManager,
  },
  run: async (_, { store, taskRunner, eventManager }) => {
    // Direct access to the framework internals
    // (Use with caution!)
  },
});
```

### Dynamic Dependencies

Dependencies can be defined in two ways - as a static object or as a function that returns an object. Each approach has its use cases:

```typescript
// Static dependencies (most common)
const userService = resource({
  id: "app.services.user",
  dependencies: { database, logger }, // Object - evaluated immediately
  init: async (_, { database, logger }) => {
    // Dependencies are available here
  },
});

// Dynamic dependencies (for circular references or conditional dependencies)
const advancedService = resource({
  id: "app.services.advanced",
  // A function gives you the chance
  dependencies: (config) => ({
    // Config is what you receive when you register tise resource with .with()
    // So you can have conditional dependencies based on resource configuration as well.
    database,
    logger,
    conditionalService:
      process.env.NODE_ENV === "production" ? serviceA : serviceB,
  }), // Function - evaluated when needed
  register: (config: ConfigType) => [
    // Config is what you receive when you register the resource with .with()
    // Register dependencies dynamically
    process.env.NODE_ENV === "production"
      ? serviceA.with({ config: "value" })
      : serviceB.with({ config: "value" }),
  ],
  init: async (_, { database, logger, conditionalService }) => {
    // Same interface, different evaluation timing
  },
});
```

The function pattern essentially gives you "just-in-time" dependency resolution instead of "eager" dependency resolution, which provides more flexibility and better handles complex dependency scenarios that arise in real-world applications.

**Performance note**: Function-based dependencies have minimal overhead - they're only called once during dependency resolution.

## Handling Circular Dependencies

Sometimes you'll run into circular type dependencies because of your file structure not necessarily because of a real circular dependency. TypeScript struggles with these, but there's a way to handle it gracefully.

### The Problem

Consider these resources that create a circular dependency:

```typescript
// FILE: a.ts
export const aResource = defineResource({
  dependencies: { b: bResource },
  // ... depends on B resource.
});
// For whatever reason, you decide to put the task in the same file.
export const aTask = defineTask({
  dependencies: { a: aResource },
});

// FILE: b.ts
export const bResource = defineResource({
  id: "b.resource",
  dependencies: { c: cResource },
});

// FILE: c.ts
export const cResource = defineResource({
  id: "c.resource",
  dependencies: { aTask }, // Creates circular **type** dependency! Cannot infer types properly, even if the runner boots because there's no circular dependency.
  async init(_, { aTask }) {
    return `C depends on aTask`;
  },
});
```

A depends B depends C depends ATask. No circular dependency, yet Typescript struggles with these, but there's a way to handle it gracefully.

### The Solution

The fix is to explicitly type the resource that completes the circle using a simple assertion `IResource<Config, ReturnType>`. This breaks the TypeScript inference chain while maintaining runtime functionality:

```typescript
// c.resource.ts - The key change
import { IResource } from "../../defs";

export const cResource = defineResource({
  id: "c.resource",
  dependencies: { a: aResource },
  async init(_, { a }) {
    return `C depends on ${a}`;
  },
}) as IResource<void, string>; // void because it has no config, string because it returns a string
```

#### Why This Works

- **Runtime**: The circular dependency still works at runtime because the framework resolves dependencies dynamically
- **TypeScript**: The explicit type annotation prevents TypeScript from trying to infer the return type based on the circular chain
- **Type Safety**: You still get full type safety by explicitly declaring the return type (`string` in this example)

#### Best Practices

1. **Identify the "leaf" resource**: Choose the resource that logically should break the chain (often the one that doesn't need complex type inference)
2. **Use explicit typing**: Add the `IResource<Dependencies, ReturnType>` type annotation
3. **Document the decision**: Add a comment explaining why the explicit typing is needed
4. **Consider refactoring**: If you have many circular dependencies, consider if your architecture could be simplified

#### Example with Dependencies

If your resource has dependencies, include them in the type:

```typescript
type MyDependencies = {
  someService: SomeServiceType;
  anotherResource: AnotherResourceType;
};

export const problematicResource = defineResource({
  id: "problematic.resource",
  dependencies: {
    /* ... */
  },
  async init(config, deps) {
    // Your logic here
    return someComplexObject;
  },
}) as IResource<MyDependencies, ComplexReturnType>;
```

This pattern allows you to maintain clean, type-safe code while handling the inevitable circular dependencies that arise in complex applications.

## Real-World Example: The Complete Package

Here's a more realistic application structure that shows everything working together:

```typescript
import {
  resource,
  task,
  event,
  middleware,
  index,
  run,
  createContext,
} from "@bluelibs/runner";

// Configuration
const config = resource({
  id: "app.config",
  init: async () => ({
    port: parseInt(process.env.PORT || "3000"),
    databaseUrl: process.env.DATABASE_URL!,
    jwtSecret: process.env.JWT_SECRET!,
  }),
});

// Database
const database = resource({
  id: "app.database",
  dependencies: { config },
  init: async (_, { config }) => {
    const client = new MongoClient(config.databaseUrl);
    await client.connect();
    return client;
  },
  dispose: async (client) => await client.close(),
});

// Context for request data
const RequestContext = createContext<{ userId?: string; role?: string }>(
  "app.requestContext"
);

// Events
const userRegistered = event<{ userId: string; email: string }>({
  id: "app.events.userRegistered",
});

// Middleware
const authMiddleware = middleware<{ requiredRole?: string }>({
  id: "app.middleware.auth",
  run: async ({ task, next }, deps, config) => {
    const context = RequestContext.use();
    if (config?.requiredRole && context.role !== config.requiredRole) {
      throw new Error("Insufficient permissions");
    }
    return next(task.input);
  },
});

// Services
const userService = resource({
  id: "app.services.user",
  dependencies: { database },
  init: async (_, { database }) => ({
    async createUser(userData: { name: string; email: string }) {
      const users = database.collection("users");
      const result = await users.insertOne(userData);
      return { id: result.insertedId.toString(), ...userData };
    },
  }),
});

// Business Logic
const registerUser = task({
  id: "app.tasks.registerUser",
  dependencies: { userService, userRegistered },
  run: async (userData, { userService, userRegistered }) => {
    const user = await userService.createUser(userData);
    await userRegistered({ userId: user.id, email: user.email });
    return user;
  },
});

const adminOnlyTask = task({
  id: "app.tasks.adminOnly",
  middleware: [authMiddleware.with({ requiredRole: "admin" })],
  run: async () => {
    return "Top secret admin data";
  },
});

// Event Handlers
const sendWelcomeEmail = task({
  id: "app.tasks.sendWelcomeEmail",
  on: userRegistered,
  run: async (event) => {
    console.log(`Sending welcome email to ${event.data.email}`);
    // Email sending logic here
  },
});

// Group everything together
const services = index({
  userService,
  registerUser,
  adminOnlyTask,
});

// Express server
const server = resource({
  id: "app.server",
  register: [config, database, services, sendWelcomeEmail],
  dependencies: { config, services },
  init: async (_, { config, services }) => {
    const app = express();
    app.use(express.json());

    // Middleware to set up request context
    app.use((req, res, next) => {
      RequestContext.provide(
        { userId: req.headers["user-id"], role: req.headers["user-role"] },
        () => next()
      );
    });

    app.post("/register", async (req, res) => {
      try {
        const user = await services.registerUser(req.body);
        res.json({ success: true, user });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    app.get("/admin", async (req, res) => {
      try {
        const data = await services.adminOnlyTask();
        res.json({ data });
      } catch (error) {
        res.status(403).json({ error: error.message });
      }
    });

    const server = app.listen(config.port);
    console.log(`Server running on port ${config.port}`);
    return server;
  },
  dispose: async (server) => server.close(),
});

// Start the application
const { dispose } = await run(server);

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Shutting down gracefully...");
  await dispose();
  process.exit(0);
});
```

## Testing

### Unit Testing: Mock Everything, Test Everything

Unit testing is straightforward because everything is explicit:

```typescript
describe("registerUser task", () => {
  it("should create a user and emit event", async () => {
    const mockUserService = {
      createUser: jest.fn().mockResolvedValue({ id: "123", name: "John" }),
    };
    const mockEvent = jest.fn();

    const result = await registerUser.run(
      { name: "John", email: "john@example.com" },
      { userService: mockUserService, userRegistered: mockEvent }
    );

    expect(result.id).toBe("123");
    expect(mockEvent).toHaveBeenCalledWith({
      userId: "123",
      email: "john@example.com",
    });
  });
});
```

### Integration Testing: The Real Deal (But Actually Fun)

Spin up your whole app, keep all the middleware/events, and still test like a human. The trick: a tiny test harness.

```typescript
import {
  run,
  createTestResource,
  resource,
  task,
  override,
} from "@bluelibs/runner";

// Your real app
const app = resource({
  id: "app",
  register: [
    /* tasks, resources, middleware */
  ],
});

// Optional: overrides for infra (hello, fast tests!)
const testDb = resource({
  id: "app.database",
  init: async () => new InMemoryDb(),
});
const mockMailer = override(realMailer, { init: async () => fakeMailer });

// Create the test harness
const harness = createTestResource(app, { overrides: [testDb, mockMailer] });

// A task you want to drive in your tests
const registerUser = task({ id: "app.tasks.registerUser" /* ... */ });

// Boom: full ecosystem run (middleware, events, overrides) with a tiny driver
const { value: t, dispose } = await run(harness);
const result = await t.runTask(registerUser, { email: "x@y.z" });
expect(result).toMatchObject({ success: true });
await dispose();
```

Prefer scenario tests? Return whatever you want from the harness and assert outside:

```typescript
const flowHarness = createTestResource(
  resource({
    id: "app",
    register: [db, createUser, issueToken],
  })
);

const { value: t, dispose } = await run(flowHarness);
const user = await t.runTask(createUser, { email: "a@b.c" });
const token = await t.runTask(issueToken, { userId: user.id });
expect(token).toBeTruthy();
await dispose();
```

Why this rocks:

- Minimal ceremony, no API pollution
- Real wiring (middleware/events/overrides) – what runs in prod runs in tests
- You choose: drive tasks directly or build domain-y flows

## Semaphore

Ever had too many database connections competing for resources? Your connection pool under pressure? The `Semaphore` is here to manage concurrent operations like a professional traffic controller.

Think of it as a VIP rope at an exclusive venue. Only a limited number of operations can proceed at once. The rest wait in an orderly queue like well-behaved async functions.

```typescript
import { Semaphore } from "@bluelibs/runner";

// Create a semaphore that allows max 5 concurrent operations
const dbSemaphore = new Semaphore(5);

// Basic usage - acquire and release manually
await dbSemaphore.acquire();
try {
  // Do your database magic here
  const result = await db.query("SELECT * FROM users");
  console.log(result);
} finally {
  dbSemaphore.release(); // Critical: always release to prevent bottlenecks
}
```

Why manage permits manually when you can let the semaphore do the heavy lifting?

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
  { timeout: 10000 } // 10 second timeout
);
```

Operations can be cancelled using AbortSignal:

```typescript
const controller = new AbortController();

// Start an operation
const operationPromise = dbSemaphore.withPermit(
  async () => await veryLongOperation(),
  { signal: controller.signal }
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

## Queue

_The orderly guardian of chaos, the diplomatic bouncer of async operations._

The `Queue` class is your friendly neighborhood task coordinator. Think of it as a very polite but firm British queue-master who ensures everyone waits their turn, prevents cutting in line, and gracefully handles when it's time to close shop.

Tasks execute one after another in first-in, first-out order. No cutting, no exceptions, no drama.

Using the clever `AsyncLocalStorage`, our Queue can detect when a task tries to queue another task (the async equivalent of "yo dawg, I heard you like queues..."). When caught red-handed, it politely but firmly rejects with a deadlock error.

The Queue provides cooperative cancellation through the Web Standard `AbortController`:

- **Patient mode** (default): Waits for all queued tasks to complete naturally
- **Cancel mode**: Signals running tasks to abort via `AbortSignal`, enabling early termination

```typescript
import { Queue } from "@bluelibs/runner";

const queue = new Queue();

// Queue up some work
const result = await queue.run(async (signal) => {
  // Your async task here
  return "Task completed";
});

// Graceful shutdown
await queue.dispose();
```

### AbortController Integration

The Queue provides each task with an `AbortSignal` for cooperative cancellation. Tasks should periodically check this signal to enable early termination.

#### Example: Long-running Task

```typescript
const queue = new Queue();

// Task that respects cancellation
const processLargeDataset = queue.run(async (signal) => {
  const items = await fetchLargeDataset();

  for (const item of items) {
    // Check for cancellation before processing each item
    if (signal.aborted) {
      throw new Error("Operation was cancelled");
    }

    await processItem(item);
  }

  return "Dataset processed successfully";
});

// Cancel all running tasks
await queue.dispose({ cancel: true });
```

#### Example: Network Request with Timeout

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

#### Example: File Processing with Progress Tracking

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
- `executionContext`: AsyncLocalStorage-based deadlock detection mechanism

#### Implement Cooperative Cancellation

Tasks should regularly check the `AbortSignal` and respond appropriately:

```typescript
// Preferred: Use signal.throwIfAborted() for immediate termination
signal.throwIfAborted();

// Alternative: Check signal.aborted for custom handling
if (signal.aborted) {
  cleanup();
  throw new Error("Operation cancelled");
}
```

##### Integrate with Native APIs

Many Web APIs accept `AbortSignal`:

- `fetch(url, { signal })`
- `setTimeout(callback, delay, { signal })`
- Custom async operations

##### Avoid Nested Queuing

The Queue prevents deadlocks by rejecting attempts to queue tasks from within running tasks. Structure your code to avoid this pattern.

##### Handle AbortError Gracefully

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

---

_Cooperative task scheduling with professional-grade cancellation support_

### Real-World Examples

### Database Connection Pool Manager

```typescript
class DatabaseManager {
  private semaphore = new Semaphore(10); // Max 10 concurrent queries

  async query(sql: string, params?: any[]) {
    return this.semaphore.withPermit(
      async () => {
        const connection = await this.pool.getConnection();
        try {
          return await connection.query(sql, params);
        } finally {
          connection.release();
        }
      },
      { timeout: 30000 } // 30 second timeout
    );
  }

  async shutdown() {
    this.semaphore.dispose();
    await this.pool.close();
  }
}
```

### Rate-Limited API Client

```typescript
class APIClient {
  private rateLimiter = new Semaphore(5); // Max 5 concurrent requests

  async fetchUser(id: string, signal?: AbortSignal) {
    return this.rateLimiter.withPermit(
      async () => {
        const response = await fetch(`/api/users/${id}`, { signal });
        return response.json();
      },
      { signal, timeout: 10000 }
    );
  }
}
```

## Anonymous IDs

One of our favorite quality-of-life features: **anonymous IDs**. Instead of manually naming every component, the framework can generate unique symbol-based identifiers based on your file path and variable name. It's like having a really good naming assistant who never gets tired.

### How Anonymous IDs Work

When you omit the `id` property, the framework generates a unique symbol based on file path. Takes up until first 'src' or 'node_modules' and generates based on the paths.

```typescript
// In src/services/email.ts
const emailService = resource({
  // Generated ID: Symbol('services.email.resource')
  init: async () => new EmailService(),
});

// In src/tasks/user.ts
const createUser = task({
  // Generated ID: Symbol('tasks.user.task')
  dependencies: { emailService },
  run: async (userData, { emailService }) => {
    // Business logic
  },
});
```

### Benefits of Anonymous IDs

1. **Less Bikeshedding**: No more debates about naming conventions
2. **Automatic Uniqueness**: Guaranteed collision-free identifiers folder based
3. **Faster Prototyping**: Just write code, framework handles the rest
4. **Refactor-Friendly**: Rename files/variables and IDs update automatically
5. **Stack Trace Integration**: Error messages include helpful file locations

### Debugging with Anonymous IDs

Anonymous IDs show up clearly in error messages and logs:

```typescript
// Error message example:
// TaskRunError: Task failed at Symbol('tasks.payment.task')
//   at file:///project/src/tasks/payment.ts:15:23

// Logging with context:
logger.info("Processing payment", {
  taskId: processPayment.definition.id, // Symbol('tasks.payment.task')
  file: "src/tasks/payment.ts",
});
```

## Why Choose BlueLibs Runner?

### What You Get

- **Type Safety**: Full TypeScript support with intelligent inference
- **Testability**: Everything is mockable and testable by design
- **Flexibility**: Compose your app however you want
- **Performance**: Built-in caching and optimization
- **Clarity**: Explicit dependencies, no hidden magic
- **Developer Experience**: Helpful error messages and clear patterns

## The Migration Path

Coming from Express? No problem. Coming from NestJS? We feel your pain. Coming from Spring Boot? Welcome to the light side.

The beauty of BlueLibs Runner is that you can adopt it incrementally. Start with one task, one resource, and gradually refactor your existing code. No big bang rewrites required - your sanity will thank you.

## Community & Support

This is part of the [BlueLibs](https://www.bluelibs.com) ecosystem. We're not trying to reinvent everything – just the parts that were broken.

- [GitHub Repository](https://github.com/bluelibs/runner) - ⭐ if you find this useful
- [Documentation](https://bluelibs.github.io/runner/) - When you need the full details
- [Issues](https://github.com/bluelibs/runner/issues) - When something breaks (or you want to make it better)

## The Bottom Line

BlueLibs Runner is what happens when you take all the good ideas from modern frameworks and leave out the parts that make you want to switch careers. It's TypeScript-first, test-friendly, and actually makes sense when you read it six months later.

Give it a try. Your future self (and your team) will thank you.

_P.S. - Yes, we know there are 47 other JavaScript frameworks. This one's different. (No, really, it is.)_

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
