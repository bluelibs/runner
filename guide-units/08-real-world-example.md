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
  .asyncContext<{ userId?: string; role?: string }>("app.ctx.request")
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
    async (server) =>
      new Promise<void>((resolve) => server.close(() => resolve())),
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

> **runtime:** "Real-World Example: the happy path. In production you'll add validation, auth, observability, and a few weird edge cases. The wiring pattern stays the same."
