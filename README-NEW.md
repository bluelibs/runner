# BlueLibs Runner: The Framework That Actually Makes Sense

_Or: How I Learned to Stop Worrying and Love Dependency Injection_

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
    // Guess what? Everything type-safe, automatically infered from the 'on' property
    console.log(`Welcome email sent to ${eventData.data.email}`);
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

## Context: Request-Scoped Data That Doesn't Drive You Insane

Ever tried to pass user data through 15 function calls? Yeah, we've been there. Context fixes that.

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

## Configuration: Because Hardcoding Is for Amateurs

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
  ],
});
```

## Dependency Management: The Index Pattern

When your app grows beyond "hello world", you'll want to group related dependencies. The `index()` helper is your friend.

```typescript
// This is basically a 3-in-1 resource, which registers, depends on them and returns them.
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

Errors happen. When they do, you can listen for them and decide what to do.

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

    // Don't let the error bubble up, this will lead the task to return undefined, which might cause other errors.
    event.data.suppress();
  },
});
```

## Caching: Built-in Performance

```typescript
import { globals } from "@bluelibs/runner";

const expensiveTask = task({
  id: "app.tasks.expensive",
  middleware: [
    globals.middleware.cache.with({
      ttl: 60 * 1000, // Cache for 1 minute
      keyBuilder: (taskId, input) => `${taskId}-${input.userId}`,
    }),
  ],
  run: async ({ userId }) => {
    // This expensive operation will be cached
    return await doExpensiveCalculation(userId);
  },
});
```

## Testing: Actually Enjoyable

Unit testing is straightforward because everything is explicit:

```typescript
describe("createUser task", () => {
  it("should create a user", async () => {
    const mockUserService = {
      createUser: jest.fn().mockResolvedValue({ id: "123" }),
    };

    const result = await createUser.run(
      { name: "John", email: "john@example.com" },
      { userService: mockUserService }
    );

    expect(result.id).toBe("123");
  });
});
```

Integration testing (or just hacking around other libraries) with overrides:

```typescript
const testApp = resource({
  id: "test.app",
  register: [productionApp],
  overrides: [
    // Replace the real database with a test one
    resource({
      ...database,
      init: async () => new TestDatabase(),
    }),
  ],
});
```

## Real-World Example: The Complete Package

Here's a more realistic application structure:

```typescript
import {
  resource,
  task,
  event,
  middleware,
  index,
  run,
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

// Events
const userRegistered = event<{ userId: string; email: string }>({
  id: "app.events.userRegistered",
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
});

// Express server
const server = resource({
  id: "app.server",
  register: [config, database, services, sendWelcomeEmail],
  dependencies: { config, services },
  init: async (_, { config, services }) => {
    const app = express();
    app.use(express.json());

    // Split later
    app.post("/register", async (req, res) => {
      try {
        const user = await services.registerUser(req.body);
        res.json({ success: true, user });
      } catch (error) {
        res.status(400).json({ error: error.message });
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
  await dispose();
  process.exit(0);
});
```

## Why Choose BlueLibs Runner?

### What You Get

- **Type Safety**: Full TypeScript support with intelligent inference
- **Testability**: Everything is mockable and testable by design
- **Flexibility**: Compose your app however you want
- **Performance**: Built-in caching and optimization
- **Clarity**: Explicit dependencies, no hidden magic

### What You Don't Get

- Complex configuration files
- Decorator hell
- Hidden dependencies
- Framework lock-in
- Mysterious behavior at runtime

## The Migration Path

Coming from Express? No problem. Coming from NestJS? We feel your pain. Coming from Spring Boot? Welcome to the light side.

The beauty of BlueLibs Runner is that you can adopt it incrementally. Start with one task, one resource, and gradually refactor your existing code. No big bang rewrites required.

## Community & Support

This is part of the [BlueLibs](https://www.bluelibs.com) ecosystem. We're not trying to reinvent everything – just the parts that were broken.

- [GitHub Repository](https://github.com/bluelibs/runner) - ⭐ if you find this useful
- [Documentation](https://bluelibs.github.io/runner/) - When you need the full details
- [Issues](https://github.com/bluelibs/runner/issues) - When something breaks (or you want to make it better)

## The Bottom Line

BlueLibs Runner is what happens when you take all the good ideas from modern frameworks and leave out the parts that make you want to switch careers. It's TypeScript-first, test-friendly, and actually makes sense when you read it six months later.

Give it a try. Your future self (and your team) will thank you.

_P.S. - Yes, we know there are 47 other JavaScript frameworks. This one's different. (No, really, it is.)_
