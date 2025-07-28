# BlueLibs Runner - Project Summary for Claude

## Core Concepts

- **Tasks**: Units of logic with `run()` function - like functions that can depend on resources/other tasks
- **Resources**: Singletons with `init()` function - services, configs, database connections, etc.
- **Events**: Async communication between components - all tasks/resources can emit/listen
- **Middleware**: Intercept task execution or resource initialization

## Key Patterns

- Everything must be explicitly registered to be used (registration only in resources)
- Async-first philosophy - all operations are async
- Functional approach - prefer tasks over classes for business logic
- Circular dependency detection with helpful error messages

## Dependency Injection

- Tasks: injected as functions `deps.myTask(input)`
- Resources: injected as their return value `deps.myResource.someMethod()`
- Events: injected as functions `deps.myEvent(payload)`
- Context: shared across async boundaries using `createContext()`

## Basic Architecture Example

```typescript
import { resource, task, run } from "@bluelibs/runner";

// Database resource
const db = resource({
  id: "app.db",
  init: async () => new MongoClient(process.env.DATABASE_URL),
  dispose: async (client) => await client.close(),
});

// Business logic task
const createUser = task({
  id: "app.tasks.createUser",
  dependencies: { db },
  run: async (userData: { name: string; email: string }, { db }) => {
    const users = db.collection("users");
    const result = await users.insertOne(userData);
    return result.insertedId;
  },
});

// Express server resource
const server = resource({
  id: "app.server",
  register: [db, createUser], // Register dependencies
  dependencies: { createUser },
  init: async (config: { port: number }, { createUser }) => {
    const app = express();

    app.post("/users", async (req, res) => {
      const userId = await createUser(req.body);
      res.json({ id: userId });
    });

    return app.listen(config.port);
  },
  dispose: async (server) => server.close(),
});

// Run the application, value is return value of init(), dispose a function to cleanup.
const { value, dispose } = run(server, { port: 3000 });
```

## Configuration Examples

```typescript
// Resource with configuration
const emailer = resource({
  id: "app.emailer",
  init: async (config: { smtpUrl: string; from: string }) => ({
    send: async (to: string, subject: string, body: string) => {
      // Send email logic using config.smtpUrl and config.from
    },
  }),
});

// Register with config
const app = resource({
  id: "app",
  register: [
    emailer.with({ smtpUrl: "smtp://localhost", from: "noreply@app.com" }),
  ],
});
```

## Events Example

```typescript
import { event, task, resource } from "@bluelibs/runner";

// Define event
const userRegistered = event<{ userId: string; email: string }>({
  id: "app.events.userRegistered",
});

// Task that emits event
const registerUser = task({
  id: "app.tasks.registerUser",
  dependencies: { userRegistered },
  run: async (userData, { userRegistered }) => {
    // Registration logic...
    const userId = "user123";

    // Emit event
    await userRegistered({ userId, email: userData.email });
    return userId;
  },
});

// Task that listens to event
const sendWelcomeEmail = task({
  id: "app.tasks.sendWelcomeEmail",
  on: userRegistered, // Listen to event
  run: async (eventData) => {
    console.log(`Sending welcome email to ${eventData.data.email}`);
    // Send email logic...
  },
});
```

## Middleware Example

```typescript
import { middleware, task } from "@bluelibs/runner";

// Auth middleware with configuration
const authMiddleware = middleware<{ requiredRole: string }>({
  id: "app.middleware.auth",
  run: async ({ config, task, next }) => {
    const user = task.input.user;
    if (!user || user.role !== config.requiredRole) {
      throw new Error("Unauthorized");
    }
    return next(task.input);
  },
});

// Apply middleware to task
const adminTask = task({
  id: "app.tasks.adminPanel",
  middleware: [authMiddleware.with({ requiredRole: "admin" })],
  run: async (input: { user: { role: string } }) => {
    return "Admin panel data";
  },
});
```

## Context Example

```typescript
import { createContext, task, resource } from "@bluelibs/runner";

// Create typed context
const RequestContext = createContext<{ requestId: string; userId: string }>(
  "app.request"
);

// Middleware that provides context
const requestMiddleware = middleware({
  id: "app.middleware.request",
  run: async ({ next, task }) => {
    return RequestContext.provide(
      {
        requestId: generateId(),
        userId: task.input.userId,
      },
      async () => {
        return next(task.input);
      }
    );
  },
});

// Task that uses context
const processRequest = task({
  id: "app.tasks.processRequest",
  middleware: [requestMiddleware],
  run: async (input) => {
    const request = RequestContext.use(); // Access context
    console.log(
      `Processing request ${request.requestId} for user ${request.userId}`
    );
  },
});
```

## Index Helper Example

```typescript
import { index, resource, task } from "@bluelibs/runner";

const userService = resource({
  id: "app.services.user",
  init: async () => ({ getUser: (id: string) => ({ id, name: "John" }) }),
});

const createUser = task({
  id: "app.tasks.createUser",
  dependencies: { userService },
  run: async (userData, { userService }) => {
    // Create user logic
  },
});

// Group dependencies
const services = index({
  userService,
  createUser,
});

// Use grouped dependencies
const app = resource({
  id: "app",
  register: [services],
  dependencies: { services },
  init: async (_, { services }) => {
    // Access all services through one dependency
    const user = await services.createUser({ name: "Jane" });
  },
});
```

## Resource Context (for shared state between init/dispose)

```typescript
const dbResource = resource({
  id: "app.db",
  context: () => ({
    connections: new Map(),
    pools: [],
  }),
  init: async (config, deps, ctx) => {
    const db = await connect(config.url);
    ctx.connections.set("main", db);
    ctx.pools.push(createPool(db));
    return db;
  },
  dispose: async (db, config, deps, ctx) => {
    for (const pool of ctx.pools) {
      await pool.drain();
    }
    for (const [name, conn] of ctx.connections) {
      await conn.close();
    }
  },
});
```

## Error Handling Example

```typescript
const riskyTask = task({
  id: "app.tasks.risky",
  run: async () => {
    throw new Error("Something went wrong");
  },
});

// Listen to task errors
const errorHandler = task({
  id: "app.tasks.errorHandler",
  on: riskyTask.events.onError,
  run: async (event) => {
    console.error("Task failed:", event.data.error);
    event.data.suppress(); // Prevent error propagation
  },
});
```

## Testing Examples

```typescript
// Unit testing
describe("createUser task", () => {
  it("should create user", async () => {
    const mockDb = {
      collection: () => ({ insertOne: () => ({ insertedId: "123" }) }),
    };
    const result = await createUser.run(
      { name: "John", email: "john@example.com" },
      { db: mockDb }
    );
    expect(result).toBe("123");
  });
});

// Integration testing with overrides
const testApp = resource({
  id: "test.app",
  register: [app],
  overrides: [
    // Override db with test database
    resource({
      ...db,
      init: async () => new TestDatabase(),
    }),
  ],
});
```

## Important Details

- Use `.with(config)` to configure resources/middleware
- `index()` helper for grouping dependencies
- Context system for request-scoped data using `createContext()`
- Built-in caching middleware with `globals.middleware.cache`
- Global events for lifecycle hooks (`global.tasks.beforeRun`, etc.)
- Error handling with suppression capability via `event.data.suppress()`
- Override system for replacing components
- Built-in logging with levels (trace/debug/info/warn/error/critical)

## Naming Convention

- Tasks: `{domain}.tasks.{taskName}` (e.g., "app.tasks.createUser")
- Resources: `{domain}.resources.{resourceName}` (e.g., "app.resources.database")
- Events: `{domain}.events.{eventName}` (e.g., "app.events.userRegistered")
- Middleware: `{domain}.middleware.{middlewareName}` (e.g., "app.middleware.auth")

## Project Structure

```
src/
├── index.ts                          # Main entry point, exports all public APIs
├── define.ts                         # Core definition functions (task, resource, event, middleware, index)
├── defs.ts                          # TypeScript interfaces and type definitions
├── context.ts                       # Context system implementation with AsyncLocalStorage
├── run.ts                           # Main runner function that orchestrates execution
├── errors.ts                        # Custom error classes and error handling
├── globals/
│   ├── globalEvents.ts              # Built-in global events (beforeRun, afterRun, etc.)
│   ├── globalMiddleware.ts          # Built-in global middleware exports
│   ├── globalResources.ts           # Built-in global resources (store, logger, etc.)
│   ├── middleware/
│   │   ├── cache.middleware.ts      # Built-in caching middleware with LRU support
│   │   ├── requireContext.middleware.ts # Middleware to require context presence
│   │   └── retry.middleware.ts      # Retry middleware for failed tasks
│   └── resources/
│       └── queue.resource.ts        # Built-in queue resource for task scheduling
├── models/
│   ├── index.ts                     # Exports all models
│   ├── DependencyProcessor.ts       # Handles dependency injection and resolution
│   ├── EventManager.ts              # Manages event emission and listening
│   ├── Logger.ts                    # Built-in logging system with levels
│   ├── Queue.ts                     # Queue implementation for task management
│   ├── ResourceInitializer.ts      # Handles resource initialization lifecycle
│   ├── Store.ts                     # Central registry for all tasks/resources/events/middleware
│   └── TaskRunner.ts                # Executes tasks with middleware and dependency injection
└── tools/
    ├── findCircularDependencies.ts  # Detects circular dependencies in the dependency graph
    └── getCallerFile.ts             # Utility to get caller file information for debugging
```

### Key Files Description:

- **index.ts**: Main API surface, exports `task`, `resource`, `event`, `middleware`, `index`, `run`, `createContext`, and `globals`
- **define.ts**: Contains the factory functions that create task/resource/event/middleware definitions
- **defs.ts**: All TypeScript interfaces and symbols used throughout the framework
- **context.ts**: Implements React-like context system using Node.js AsyncLocalStorage for request-scoped data
- **run.ts**: The main orchestrator that initializes resources, handles dependencies, and starts execution
- **Store.ts**: Central registry that manages all registered components and their relationships
- **TaskRunner.ts**: Core execution engine that runs tasks with middleware pipeline and dependency injection
- **EventManager.ts**: Handles event emission with source tracking and listener management
- **DependencyProcessor.ts**: Resolves and injects dependencies for tasks and resources
- **ResourceInitializer.ts**: Manages resource lifecycle (init/dispose) with proper cleanup
- **Logger.ts**: Built-in logging system with configurable levels and event-based architecture

## Common Commands

- Check for lint/typecheck commands in package.json or ask user
- Look for test scripts in package.json
- Use `npm run dev` or similar for development mode
- Run tests with `npm test` or similar
