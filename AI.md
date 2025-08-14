# BlueLibs Runner Quick Reference

## Core Concepts

- Remember TERM (tasks, events, resources, middleware)
- Tasks can be stand alone tasks or listeners (that listen to events)
- Everything is designed to be typesafe
- Any function you use can be imported like `import { task, resource, etc } from "@bluelibs/runner"`

## At a Glance (API Surface)

- `task`:
  - Business logic with DI, optional `on` (listen to event) and `middleware`.
  - Shape: `{ id?, dependencies?, on?, middleware?, run(input, deps) }`.
- `resource`:
  - Singleton, optional `dependencies`, `register`, `dispose`, `context`.
  - Shape: `{ id?, dependencies?, register?, init(config, deps, ctx), dispose?, context? }`.
- `event<T>`:
  - Emits/handles async events: `const e = event<T>({ id })` then `await e(payload)`.
- `middleware`:
  - Wraps tasks/resources: `run({ task|resource, next }, deps, config?)`.
  - Use `.with(config)` and `.everywhere({ tasks?, resources? })`.
- `index(obj)`:
  - Groups multiple entries into one dependency that also registers them.
- `run(resource)`:
  - Boots the app tree: returns `{ value, dispose }`.
- `override(original, changes)`:
  - Safe behavior override while preserving identity (id cannot change).
- `createContext<T>(id)`:
  - Request-scoped data: `.provide(value, fn)`, `.use()`, `.require()`.
- `tag<TConfig, TContract>`:
  - Metadata (stored in meta.tags) and contracts; `.with(config)`, `.extract(def|tags)`.
- `globals`:
  - Built-ins: `middleware.cache`, `middleware.retry`, `resources.logger`, `events`, etc.
- `Semaphore` / `Queue`:
  - Concurrency primitives for limits and FIFO execution.

## Runtime Order & Rules

- Registration → Overrides → Dependency resolution → Global middleware → Init resources → Task run → Emit events → Listeners → Dispose.
- Middleware order: global first, then component-level; both wrap execution around `run()`.
- Event listeners: ordered by `listenerOrder` (lower runs first, default 0). `event.stopPropagation()` prevents later listeners.
- Error events: handlers may call `event.data.suppress()` to prevent error bubbling (task returns `undefined`).
- Overrides: applied after registration; the override closest to the root wins.
- Dependencies: object or factory function. Factory form delays evaluation and helps with circular type dependencies.

## Contract Tags (Return Types)

Use tag contracts to enforce returned value shapes of tasks and of resource `init()` at compile time.

```typescript
const userContract = tag<void, { name: string }>({ id: "contract.user" });

const getUser = task({
  id: "app.tasks.getUser",
  meta: { tags: [userContract] },
  run: async () => ({ name: "Ada" }), // must satisfy contract
});
```

Multiple contracts intersect; use `[] as const` to indicate empty tags.

## Anonymous IDs (Quick Guidance)

- Great defaults for internal tasks/resources; IDs derive from file/var names.
- Prefer manual IDs for events, middleware, public APIs, and cross-package references.

## Production Checklist

- Add global retry/timeouts around external I/O; size cache appropriately.
- Handle signals and call `dispose()` for graceful shutdown.
- Use `Semaphore`/`Queue` for concurrency control.
- Add health checks and basic metrics where needed.

## See Also

- README: Logging, Cache, Retry, Tags & Contracts, Queue, Semaphore, Overrides, Testing Harness.
- Typedocs: full API reference.

### `resource`: Singleton for shared services (DB, configs)

```typescript
// A simple resource (e.g., config)
const config = resource({
  id: "app.config",
  // The singleton value returned by init
  init: async () => ({ port: 3000 }),
  // Metadata for resources, tasks, events and middleware.
  meta: {
    title: "Title of resource",
    description: """
Describe what it does
""",
    tags: [], // later on
  }
});

// A resource with dependencies and a dispose method for cleanup
const database = resource({
  id: "app.db",
  dependencies: { config },
  // Types are automatically infered
  init: async (_, { config }) => {
    // connect to db using config.port
    const client = new DBClient();
    return client;
  },
  dispose: async (client) => client.close(),
});

// A resource that requires configuration when registered
const emailer = resource({
  id: "app.emailer",
  init: async (config: { apiKey: string }) => {
    // use config.apiKey
    return new EmailService(config.apiKey);
  },
});

// All resources have to be registered, every element needs to be registered, and registration can only be done by a resource.
const app = resource({
  id: "app.root",
  register: [
    emailer.with({ apiKey: "xxx" }), // Stuff that can be configured like resources, middleware, and later tags we do with with()
    database,
    config,
  ],
})
```

### `task`: Your business logic functions

```typescript
// A task that performs an action, with dependencies
const createUser = task({
  id: "app.tasks.createUser",)
  dependencies: { db: database },
  run: async (userData: { name: string }, { db }) => {
    return db.collection("users").insertOne(userData);
  },
});
```

### `event`: For decoupled, async communication

```typescript
// 1. Define an event with a specific payload shape
const userRegistered = event<{ userId: string }>("app.events.userRegistered");

// 2. A task that emits the event
const registerUser = task({
  id: "app.tasks.registerUser",
  dependencies: { userRegistered }, // Depend on the event to emit it
  run: async (userData, { userRegistered }) => {
    const userId = "user-123";
    await userRegistered({ userId }); // Emit the event
    return { id: userId };
  },
});

// 3. A listener task that reacts to the event
const sendWelcomeEmail = task({
  id: "app.tasks.sendWelcomeEmail",
  on: userRegistered, // Listen for the event
  run: async (event) => {
    // event.data is typed { userId: string }
    console.log(`Sending email to user: ${event.data.userId}`);
  },
});
```

### `middleware`: Wrap tasks/resources for cross-cutting concerns

```typescript
// A middleware to check for authentication
const authMiddleware = middleware({
  id: "app.middleware.auth",
  run: async ({ task, next }, deps, config: { role: string }) => {
    // const user = UserContext.use();
    // if (user.role !== config.role) throw new Error("Unauthorized");
    return next(task.input);
  },
});

// A task that uses the middleware
const adminTask = task({
  id: "app.tasks.adminOnly",
  middleware: [authMiddleware.with({ role: "admin" })],
  run: async () => "Secret admin data",
});
```

### `createContext`: For request-scoped or async-local data

```typescript
// 1. Define a context with a specific shape
const UserContext = createContext<{ userId: string }>("app.userContext");

// 2. A task that requires and uses the context
const getUserProfile = task({
  id: "app.tasks.getUserProfile",
  middleware: [UserContext.require()], // Ensures context is present
  run: async () => {
    const user = UserContext.use(); // Access context data
    return { id: user.userId, profile: "..." };
  },
});

// 3. Provide the context at an entry point (e.g., request handler)
// This would typically be in a resource that handles incoming requests
async function handleApiRequest() {
  return UserContext.provide({ userId: "user-456" }, async () => {
    return await getUserProfile(); // This call now has access to the context
  });
}
```

### `index`: Group related dependencies together

```typescript
// Groups all services into a single, injectable object
const services = index({
  userService,
  paymentService,
  notificationService,
});

// Use it in another resource
const appController = resource({
  id: "app.controller",
  dependencies: { services },
  init: async (_, { services }) => {
    // Access all services via one property
    await services.userService.doSomething();
  },
});
```

### `tag`: Metadata for documentation and smart behavior

```typescript
// Define a reusable tag with configuration
const performanceTag = tag<{ criticalAboveMs: number }>(
  "performance.monitoring"
);

// Use the tag in a task's metadata
const expensiveTask = task({
  id: "app.tasks.expensive",
  meta: {
    description: "A very slow task.",
    tags: ["analytics", performanceTag.with({ criticalAboveMs: 1000 })],
  },
  run: async () => {
    /* ... */
  },
});

// A middleware that reads the tag to alter behavior
const perfMiddleware = middleware({
  id: "app.middleware.performance",
  dependencies: {
    /* ... */
  },
  run: async ({ task, next }, deps) => {
    const perfConfig = performanceTag.extract(task.definition);
    if (perfConfig) {
      const start = Date.now();
      const result = await next(task.input);
      const duration = Date.now() - start;
      // ... other stuff ...
      return result;
    }
    return next(task.input);
  },
});
```

## Running & Testing

### `run`: Start the application

```typescript
// Define the main application resource
const app = resource({
  id: "app",
  register: [
    config,
    database,
    emailer.with({ apiKey: "..." }),
    createUser,
    sendWelcomeEmail,
  ],
});

// Start the app and get a dispose function for graceful shutdown
const { value, dispose } = await run(app); // Value is what the root's init() returns if present

// Later, to clean up resources:
// await dispose();
```

### `override`: Swap components for testing or different environments

```typescript
// The real resource
const productionDb = resource({
  id: "app.db",
  init: async () => new RealDatabase(),
});

// The override for testing
const testDb = override(productionDb, {
  init: async () => new InMemoryDatabase(),
});

// In the test setup
const testApp = resource({
  id: "test.app",
  register: [productionDb],
  overrides: [testDb], // The override is applied here
});

const { dispose } = await run(testApp);
```

### `createTestResource`: A harness for integration testing

```typescript
// Your main app definition
const app = resource({
  id: "app",
  register: [productionDb, createUser],
});

// Create a test harness, applying overrides
const harness = createTestResource(app, {
  overrides: [testDb],
});

// In your test file
test("user registration", async () => {
  const { value: t, dispose } = await run(harness);

  // Run a task within the fully initialized app environment
  const result = await t.runTask(createUser, { name: "test" });

  expect(result.name).toBe("test");

  await dispose();
});
```

## Built-in Globals

### `globals.middleware.cache`: Automatic caching for tasks

```typescript
const expensiveQuery = task({
  id: "app.tasks.expensiveQuery",
  middleware: [
    globals.middleware.cache.with({
      ttl: 60 * 1000, // Cache for 1 minute
    }),
    globals.middleware.retry.with({
      retries: 3, // Try up to 3 times
      delayStrategy: (attempt) => 100 * attempt, // Wait longer each time
    }),
  ],
  run: async (params) => {
    /* slow db query */
  },
});
```

### `globals.resources.logger`: Structured, event-driven logging

```typescript
const someTask = task({
  id: "app.tasks.someTask",
  dependencies: { logger: globals.resources.logger },
  run: async (_, { logger }) => {
    logger.info("Task started", { data: { input: "..." } });

    try {
      // ...
    } catch (error) {
      logger.error("Task failed", { error });
    }
  },
});

// To see logs in the console, you must set a print threshold
const setupLogging = task({
  id: "app.logging.setup",
  on: globals.resources.logger.events.afterInit,
  run: async ({ data }) => {
    data.value.setPrintThreshold("info"); // Print info, warn, error, critical
  },
});
```
