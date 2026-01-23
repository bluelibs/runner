## Real-World Example: The Complete Package

This example shows everything working together in a realistic Express application:

| Component          | What it demonstrates                         |
| ------------------ | -------------------------------------------- |
| `config`           | Environment-based configuration              |
| `database`         | Resource with lifecycle (connect/disconnect) |
| `RequestContext`   | Per-request state via async context          |
| `userRegistered`   | Typed event emission                         |
| `authMiddleware`   | Role-based access control                    |
| `userService`      | Business logic as a resource                 |
| `registerUser`     | Task with dependencies and events            |
| `sendWelcomeEmail` | Hook reacting to events                      |
| `server`           | Express integration with graceful shutdown   |

```typescript
import express from "express";
import { MongoClient } from "mongodb";
import { r, run } from "@bluelibs/runner";

// Configuration
const config = r
  .resource("app.config")
  .init(async () => ({
    port: parseInt(process.env.PORT || "3000"),
    databaseUrl: process.env.DATABASE_URL!,
    jwtSecret: process.env.JWT_SECRET!,
  }))
  .build();

// Database
const database = r
  .resource("app.database")
  .dependencies({ config })
  .init(async (_config, { config }) => {
    const client = new MongoClient(config.databaseUrl);
    await client.connect();
    return client;
  })
  .dispose(async (client) => await client.close())
  .build();

// Context for request data
const RequestContext = r
  .asyncContext<{ userId?: string; role?: string }>("app.requestContext")
  .build();

// Email service (replace with SendGrid/SES/etc in real apps)
const emailService = r
  .resource("app.services.email")
  .init(async () => ({
    async sendWelcome(email: string) {
      console.log(`(email) welcome -> ${email}`);
    },
  }))
  .build();

// Events
const userRegistered = r
  .event("app.events.userRegistered")
  .payloadSchema<{ userId: string; email: string }>({ parse: (v) => v })
  .build();

// Middleware
const authMiddleware = r.middleware
  .task("app.middleware.task.auth")
  .run(async ({ task, next }, deps, config?: { requiredRole?: string }) => {
    const context = RequestContext.use();
    if (config?.requiredRole && context.role !== config.requiredRole) {
      throw new Error("Insufficient permissions");
    }
    return next(task.input);
  })
  .build();

// Services
const userService = r
  .resource("app.services.user")
  .dependencies({ database })
  .init(async (_config, { database }) => ({
    async createUser(userData: { name: string; email: string }) {
      const users = database.collection("users");
      const result = await users.insertOne(userData);
      return { id: result.insertedId.toString(), ...userData };
    },
  }))
  .build();

// Business Logic
const registerUser = r
  .task("app.tasks.registerUser")
  .dependencies({ userService, userRegistered })
  .run(
    async (
      userData: { name: string; email: string },
      { userService, userRegistered },
    ) => {
      const user = await userService.createUser(userData);
      await userRegistered({ userId: user.id, email: user.email });
      return user;
    },
  )
  .build();

const adminOnlyTask = r
  .task("app.tasks.adminOnly")
  .middleware([authMiddleware.with({ requiredRole: "admin" })])
  .run(async () => "Top secret admin data")
  .build();

// Event hooks
const sendWelcomeEmail = r
  .hook("app.hooks.sendWelcomeEmail")
  .on(userRegistered)
  .dependencies({ emailService })
  .run(async (event, { emailService }) => {
    console.log(`Sending welcome email to ${event.data.email}`);
    await emailService.sendWelcome(event.data.email);
  })
  .build();

// Express server
const server = r
  .resource("app.server")
  .register([
    config,
    database,
    RequestContext,
    userRegistered,
    authMiddleware,
    emailService,
    userService,
    registerUser,
    adminOnlyTask,
    sendWelcomeEmail,
  ])
  .dependencies({ config, registerUser, adminOnlyTask })
  .init(async (_config, { config, registerUser, adminOnlyTask }) => {
    const app = express();
    app.use(express.json());

    // Middleware to set up request context
    app.use((req, res, next) => {
      RequestContext.provide(
        { userId: req.get("user-id"), role: req.get("user-role") },
        () => next(),
      );
    });

    app.post("/register", async (req, res) => {
      try {
        const user = await registerUser(req.body);
        res.json({ success: true, user });
      } catch (error) {
        res.status(400).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    app.get("/admin", async (req, res) => {
      try {
        const data = await adminOnlyTask();
        res.json({ data });
      } catch (error) {
        res.status(403).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    const server = app.listen(config.port);
    console.log(`Server running on port ${config.port}`);
    return server;
  })
  .dispose(
    async (server) => new Promise<void>((resolve) => server.close(() => resolve())),
  )
  .build();

// Start the application with enhanced run options
const { dispose } = await run(server, {
  debug: "normal", // Enable debug logging
  // logs: { printStrategy: "json" }, // Use JSON log format
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Shutting down gracefully...");
  await dispose();
  process.exit(0);
});
```

> **runtime:** "Real‑World Example: the happy path. In production you’ll add validation, auth, observability, and a few weird edge cases. The wiring pattern stays the same."

## Testing

Runner's explicit dependency injection makes testing straightforward. You can call `.run()` on a task with plain mocks or spin up the full runtime when you need middleware and lifecycle behavior.

### Two testing approaches

| Approach             | Speed  | What runs      | Best for          |
| -------------------- | ------ | -------------- | ----------------- |
| **Unit test**        | Fast   | Just your code | Logic, edge cases |
| **Integration test** | Slower | Full pipeline  | End-to-end flows  |

### Unit testing (fast, isolated)

Call `.run()` directly on any task with mock dependencies. This bypasses middleware and runtime validation—you're testing pure business logic.

```typescript
describe("registerUser task", () => {
  it("creates user and emits event", async () => {
    // Create mocks
    const mockUserService = {
      createUser: jest.fn().mockResolvedValue({
        id: "user-123",
        name: "Alice",
        email: "alice@example.com",
      }),
    };
    const mockUserRegistered = jest.fn().mockResolvedValue(undefined);

    // Call the task directly - no runtime needed!
    const result = await registerUser.run(
      { name: "Alice", email: "alice@example.com" },
      { userService: mockUserService, userRegistered: mockUserRegistered },
    );

    // Assert
    expect(result.id).toBe("user-123");
    expect(mockUserRegistered).toHaveBeenCalledWith({
      userId: "user-123",
      email: "alice@example.com",
    });
  });

  it("handles duplicate email", async () => {
    const mockUserService = {
      createUser: jest.fn().mockRejectedValue(new Error("Email already exists")),
    };

    await expect(
      registerUser.run(
        { name: "Bob", email: "taken@example.com" },
        { userService: mockUserService, userRegistered: jest.fn() },
      ),
    ).rejects.toThrow("Email already exists");
  });
});
```

### Integration testing (full pipeline)

Spin up the entire app with real middleware, events, and lifecycle. Use `override()` to swap out infrastructure.

```typescript
import { run, r, override } from "@bluelibs/runner";

describe("User registration flow", () => {
  it("creates user, sends email, and tracks analytics", async () => {
    // Create test doubles for infrastructure
    const testDb = r
      .resource("app.database")
      .init(async () => new InMemoryDatabase())
      .build();

    const mockMailer = override(realMailer, {
      init: async () => ({ send: jest.fn().mockResolvedValue(true) }),
    });

    // Build test harness with overrides
    const testApp = r
      .resource("test")
      .overrides([testDb, mockMailer])
      .register([...productionComponents])
      .build();

    // Run the full app
    const { runTask, getResourceValue, dispose } = await run(testApp);

    try {
      // Execute through the full pipeline (middleware runs!)
      const user = await runTask(registerUser, {
        name: "Charlie",
        email: "charlie@test.com",
      });

      // Verify
      expect(user.id).toBeDefined();

      const mailer = await getResourceValue(mockMailer);
      expect(mailer.send).toHaveBeenCalled();
    } finally {
      await dispose();
    }
  });
});
```

### Testing tips

**Logs are suppressed in tests** by default (when `NODE_ENV=test`). To see them:

```typescript
await run(app, { debug: "verbose" });
```

**Use task references for type safety:**

```typescript
// Type-safe - autocomplete works
await runTask(registerUser, { name: "Alice", email: "alice@test.com" });

// Works but no type checking
await runTask("app.tasks.registerUser", {
  name: "Alice",
  email: "alice@test.com",
});
```

**Always dispose:**

```typescript
const { dispose } = await run(app);
try {
  // ... tests
} finally {
  await dispose(); // Clean up connections, timers, etc.
}
```

> **runtime:** "Testing: an elaborate puppet show where every string behaves. Then production walks in, kicks the stage, and asks for pagination. Still—nice coverage badge."
