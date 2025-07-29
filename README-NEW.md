# BlueLibs Runner: The Framework That Actually Makes Sense

_Or: How I Learned to Stop Worrying and Love Dependency Injection_

<p align="center">
<a href="https://github.com/bluelibs/runner/actions/workflows/ci.yml"><img src="https://github.com/bluelibs/runner/actions/workflows/ci.yml/badge.svg?branch=main" alt="Build Status" /></a>
<a href="https://coveralls.io/github/bluelibs/runner?branch=main"><img src="https://coveralls.io/repos/github/bluelibs/runner/badge.svg?branch=main" alt="Coverage Status" /></a>
<a href="https://bluelibs.github.io/runner/" target="_blank"><img src="https://img.shields.io/badge/read-typedocs-blue" alt="Docs" /></a>
<a href="https://github.com/bluelibs/runner" target="_blank"><img src="https://img.shields.io/badge/github-blue" alt="GitHub" /></a>
</p>

- [View the documentation page here](https://bluelibs.github.io/runner/)
- [Google Notebook LM Podcast](https://notebooklm.google.com/notebook/59bd49fa-346b-4cfb-bb4b-b59857c3b9b4/audio)
- [Continue GPT Conversation](https://chatgpt.com/share/670392f8-7188-800b-9b4b-e49b437d77f7)

Welcome to BlueLibs Runner, where we've taken the chaos of modern application architecture and turned it into something that won't make you question your life choices at 3am. This isn't just another framework – it's your new best friend who actually understands that code should be readable, testable, and not require a PhD in abstract nonsense to maintain.

## What Is This Thing?

BlueLibs Runner is a TypeScript-first framework that embraces functional programming principles while keeping dependency injection simple enough that you won't need a flowchart to understand your own code. Think of it as the anti-framework framework – it gets out of your way and lets you build stuff that actually works.

### The Core Philosophy (AKA Why We Built This)

- **Tasks are functions** - Not classes with 47 methods you'll never use
- **Resources are singletons** - Database connections, configs, services - the usual suspects
- **Events are just events** - Revolutionary concept, we know
- **Everything is async** - Because it's 2025 and blocking code is so 2005
- **Explicit beats implicit** - No magic, no surprises, no "how the hell does this work?"

## Quick Start (The "Just Show Me Code" Section)

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
  register: [server, createUser],
  dependencies: { server, createUser },
  init: async (_, { server, createUser }) => {
    server.app.post("/users", async (req, res) => {
      const user = await createUser(req.body);
      res.json(user);
    });
  },
});

// That's it. No webpack configs, no decorators, no XML.
const { dispose } = await run(app, { port: 3000 });
```

## The Big Four: Your New Building Blocks

### 1. Tasks: The Heart of Your Business Logic

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

#### When to Task and When Not to Task

Look, we get it. You could turn every function into a task, but that's like using a sledgehammer to crack nuts. Here's the deal:

**Make it a task when:**

- It's a high-level business action: `"app.user.register"`, `"app.order.process"`
- You want it trackable and observable
- Multiple parts of your app need it
- It's complex enough to benefit from dependency injection

**Don't make it a task when:**

- It's a simple utility function
- It's used in only one place
- It's performance-critical and doesn't need DI overhead

Think of tasks as the "main characters" in your application story, not every single line of dialogue.

### 2. Resources: Your Singletons That Don't Suck

Resources are the services, configs, and connections that live throughout your app's lifecycle. They initialize once and stick around until cleanup time.

```typescript
const database = resource({
  id: "app.db",
  init: async (config: { url: string }) => {
    const client = new MongoClient(config.url);
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

#### Resource Configuration: Because Hardcoding Is for Amateurs

Resources can be configured with type-safe options. No more "config object of unknown shape" nonsense.

```typescript
const emailer = resource({
  id: "app.emailer",
  init: async (config: { smtpUrl: string; from: string }) => ({
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

#### Shared Context Between Init and Dispose

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

### 3. Events: Async Communication That Actually Works

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
  on: userRegistered, // Listen to the event
  run: async (eventData) => {
    // Everything is type-safe, automatically inferred from the 'on' property
    console.log(`Welcome email sent to ${eventData.data.email}`);
  },
});
```

#### Wildcard Events: For When You Want to Know Everything

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

#### Global Events: The System's Built-in Gossip Network

The framework comes with its own set of events that fire during the lifecycle. Think of them as the system's way of keeping you informed:

- `global.tasks.beforeRun` - "Hey, I'm about to run this task"
- `global.tasks.afterRun` - "Task completed, here's what happened"
- `global.tasks.onError` - "Oops, something went wrong"
- `global.resources.beforeInit` - "Initializing a resource"
- `global.resources.afterInit` - "Resource is ready"
- `global.resources.onError` - "Resource initialization failed"

```typescript
const taskLogger = task({
  id: "app.logging.taskLogger",
  on: globalEvents.tasks.beforeRun,
  run(event) {
    console.log(`Running task: ${event.source} with input:`, event.data.input);
  },
});
```

### 4. Middleware: The Interceptor Pattern Done Right

Middleware wraps around your tasks and resources, adding cross-cutting concerns without polluting your business logic.

```typescript
const authMiddleware = middleware<{ requiredRole: string }>({
  id: "app.middleware.auth",
  run: async ({ task, next }, dependencies, config) => {
    const user = task.input.user;
    if (!user || user.role !== config.requiredRole) {
      throw new Error("Unauthorized");
    }
    return next(task.input);
  },
});

const adminTask = task({
  id: "app.tasks.adminOnly",
  middleware: [authMiddleware.with({ requiredRole: "admin" })],
  run: async (input: { user: User }) => {
    return "Secret admin data";
  },
});
```

#### Global Middleware: Apply Everywhere, Configure Once

Want to add logging to everything? Authentication to all tasks? Global middleware has your back:

```typescript
const logMiddleware = middleware({
  id: "app.middleware.log",
  run: async ({ task, next }) => {
    console.log(`Executing: ${task.id}`);
    const result = await next(task.input);
    console.log(`Completed: ${task.id}`);
    return result;
  },
});

const app = resource({
  id: "app",
  register: [
    logMiddleware.everywhere({ tasks: true, resources: false }), // Only tasks get logged
  ],
});
```

## Context: Request-Scoped Data That Doesn't Drive You Insane

Ever tried to pass user data through 15 function calls? Yeah, we've been there. Context fixes that without turning your code into a game of telephone.

```typescript
const UserContext = createContext<{ userId: string; role: string }>(
  "app.userContext"
);

const getUserData = task({
  id: "app.tasks.getUserData",
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

### Context with Middleware: The Power Couple

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

## Dependency Management: The Index Pattern

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

## Error Handling: Graceful Failures

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

## Caching: Built-in Performance

Because nobody likes waiting for the same expensive operation twice:

```typescript
import { globals } from "@bluelibs/runner";

const expensiveTask = task({
  id: "app.tasks.expensive",
  middleware: [
    globals.middleware.cache.with({
      // lru-cache options by default
      ttl: 60 * 1000, // Cache for 1 minute
      keyBuilder: (taskId, input) => `${taskId}-${input.userId}`,
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
      async: false, // in-memory bypasses Promise wrap focusing on speed
      // When using redis or others mark this as true to await response.
    }),
  ],
});
```

Want Redis instead of the default LRU cache? No problem - just override the cache factory task:

```typescript
import { task } from "@bluelibs/runner";

const redisCacheFactory = task({
  id: "global.tasks.cacheFactory", // Same ID as the default task
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

This approach is powerful because:

- ✅ **Testable**: You can easily mock the cache factory in tests
- ✅ **Configurable**: Different cache implementations for different environments
- ✅ **Discoverable**: The cache factory is a regular task, not hidden configuration
- ✅ **Type-safe**: Full TypeScript support for your custom cache implementation

## Logging: Because Console.log Isn't Professional

We provide a proper logging system that emits events, so you can handle logs however you want:

```typescript
import { globals } from "@bluelibs/runner";

const businessTask = task({
  id: "app.tasks.business",
  dependencies: { logger: globals.resources.logger },
  run: async (_, { logger }) => {
    await logger.info("Starting business process");
    await logger.warn("This might take a while");
    await logger.error("Oops, something went wrong");
    await logger.critical("System is on fire");
  },
});

// Set up log printing (they don't print by default)
const setupLogging = task({
  id: "app.logging.setup",
  on: globals.resources.logger.events.afterInit,
  run: async (event) => {
    const logger = event.data.value;
    logger.setPrintThreshold("info"); // Print info and above
  },
});

// Ship logs to your favorite log warehouse
const logShipper = task({
  id: "app.logging.shipper",
  on: globals.events.log,
  run: async (event) => {
    const log = event.data;
    if (log.level === "error" || log.level === "critical") {
      await shipToLogWarehouse(log);
    },
  },
});
```

## Meta: Tagging Your Components

Sometimes you want to attach metadata to your tasks and resources for documentation, filtering, or middleware logic:

```typescript
const apiTask = task({
  id: "app.tasks.api.createUser",
  meta: {
    title: "Create User API",
    description: "Creates a new user account",
    tags: ["api", "user", "public"],
  },
  run: async (userData) => {
    // Business logic
  },
});

// Middleware that only applies to API tasks
const apiMiddleware = middleware({
  id: "app.middleware.api",
  run: async ({ task, next }) => {
    if (task.meta?.tags?.includes("api")) {
      // Apply API-specific logic
    }
    return next(task.input);
  },
});
```

## Advanced Usage: When You Need More Power

### Overrides: Swapping Components at Runtime

Sometimes you need to replace a component entirely. Maybe you're testing, maybe you're A/B testing, maybe you just changed your mind:

```typescript
const productionEmailer = resource({
  id: "app.emailer",
  init: async () => new SMTPEmailer(),
});

const testEmailer = resource({
  ...productionEmailer, // Copy everything else
  init: async () => new MockEmailer(), // But use a different implementation
});

const app = resource({
  id: "app",
  register: [productionEmailer],
  overrides: [testEmailer], // This replaces the production version
});
```

### Inter-resource Communication: Resources Talking to Each Other

Sometimes resources need to modify each other. Events are perfect for this:

```typescript
const securityConfigEvent = event<{ setHasher: (fn: Function) => void }>({
  id: "app.security.config",
});

const securityResource = resource({
  id: "app.security",
  dependencies: { securityConfigEvent },
  init: async (_, { securityConfigEvent }) => {
    const security = {
      hasher: defaultHasher,
      setHasher: (fn) => {
        security.hasher = fn;
      },
    };

    // Let other resources modify the security config
    await securityConfigEvent({ setHasher: security.setHasher });

    return security;
  },
});

const customHasherExtension = task({
  id: "app.security.customHasher",
  on: securityConfigEvent,
  run: async (event) => {
    event.data.setHasher(customSHA256Hasher);
  },
});
```

### Namespacing: Keeping Things Organized

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

### Internal Services: For When You Need Direct Access

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

## Testing: Actually Enjoyable

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

### Integration Testing: The Real Deal

Integration testing with overrides lets you test the whole system with controlled components:

```typescript
const testDatabase = resource({
  id: "app.database",
  init: async () => new MemoryDatabase(), // In-memory test database
});

const testApp = resource({
  id: "test.app",
  register: [productionApp],
  overrides: [testDatabase], // Replace real database with test one
});

describe("Full application", () => {
  it("should handle user registration flow", async () => {
    const { dispose } = await run(testApp);

    // Test your application end-to-end

    await dispose(); // Clean up
  });
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

### What You Don't Get

- Complex configuration files that require a PhD to understand
- Decorator hell that makes your code look like a Christmas tree
- Hidden dependencies that break when you least expect it
- Framework lock-in that makes you feel trapped
- Mysterious behavior at runtime that makes you question reality

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
