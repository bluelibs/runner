---
name: runner-feature-builder
description: Use when implementing authentication (JWT, RBAC), caching (memory, Redis), HTTP APIs with Express, event-driven architecture, database integration (PostgreSQL, MongoDB), retry/timeout/rate-limiting, distributed systems with tunnels, logging, or asks 'how to implement X feature in Runner'
---

# Runner Feature Builder Skill

Practical implementation patterns for real-world Runner features.

## Authentication

### JWT Middleware
```ts
import { r } from "@bluelibs/runner";
import jwt from "jsonwebtoken";

const authContext = r.asyncContext<{ userId: string; role: string }>("auth").build();

const jwtAuth = r.middleware.task("jwtAuth")
  .configSchema<{ secret: string }>({ parse: (v) => v })
  .dependencies({ authContext })
  .run(async ({ task, next }, { authContext }, config) => {
    const token = task.input.token;
    if (!token) throw new Error("No token");

    const decoded = jwt.verify(token, config.secret) as { userId: string; role: string };

    return await authContext.provide(
      { userId: decoded.userId, role: decoded.role },
      async () => next(task.input)
    );
  })
  .build();

// Use in tasks
const getProfile = r.task("getProfile")
  .middleware([jwtAuth.with({ secret: process.env.JWT_SECRET })])
  .dependencies({ authContext, db })
  .run(async (input, { authContext, db }) => {
    const auth = authContext.use();
    return await db.users.findById(auth.userId);
  })
  .build();
```

### RBAC Middleware
```ts
const rbacMiddleware = r.middleware.task("rbac")
  .configSchema<{ allowedRoles: string[] }>({ parse: (v) => v })
  .dependencies({ authContext })
  .run(async ({ task, next }, { authContext }, config) => {
    const auth = authContext.use();
    if (!config.allowedRoles.includes(auth.role)) {
      throw new Error(`Forbidden: requires [${config.allowedRoles.join(", ")}]`);
    }
    return next(task.input);
  })
  .build();

// Admin-only task
const deleteUser = r.task("deleteUser")
  .middleware([
    jwtAuth.with({ secret: process.env.JWT_SECRET }),
    rbacMiddleware.with({ allowedRoles: ["admin"] })
  ])
  .run(async (userId: string) => { /* delete */ })
  .build();
```

## Caching

### Memory Cache
```ts
const memoryCache = r.middleware.task("memoryCache")
  .configSchema<{ ttl: number; keyFn?: (input: any) => string }>({ parse: (v) => v })
  .context(() => ({ cache: new Map<string, { value: any; expires: number }>() }))
  .run(async ({ task, next }, _deps, config, ctx) => {
    const key = config.keyFn ? config.keyFn(task.input) : JSON.stringify(task.input);

    const cached = ctx.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.value;
    }

    const result = await next(task.input);
    ctx.cache.set(key, { value: result, expires: Date.now() + config.ttl });

    return result;
  })
  .build();

// Use
const getUser = r.task("getUser")
  .middleware([
    memoryCache.with({ ttl: 60000, keyFn: (input) => `user:${input.id}` })
  ])
  .run(async (input: { id: string }) => { /* fetch user */ })
  .build();
```

### Redis Cache
```ts
const redisCache = r.middleware.task("redisCache")
  .configSchema<{ ttl: number; prefix: string }>({ parse: (v) => v })
  .dependencies({ redis })
  .run(async ({ task, next }, { redis }, config) => {
    const key = `${config.prefix}:${JSON.stringify(task.input)}`;

    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);

    const result = await next(task.input);
    await redis.setex(key, config.ttl / 1000, JSON.stringify(result));

    return result;
  })
  .build();
```

## HTTP API with Auto-Registration

### Define Route Tag
```ts
const httpRoute = r.tag("httpRoute")
  .configSchema<{ method: "GET" | "POST" | "PUT" | "DELETE"; path: string }>({
    parse: (v) => v
  })
  .build();
```

### Create Tagged Tasks
```ts
const getHealth = r.task("getHealth")
  .tags([httpRoute.with({ method: "GET", path: "/health" })])
  .run(async () => ({ status: "ok", timestamp: Date.now() }))
  .build();

const getUser = r.task("getUser")
  .tags([httpRoute.with({ method: "GET", path: "/users/:id" })])
  .middleware([jwtAuth.with({ secret: process.env.JWT_SECRET })])
  .inputSchema<{ id: string; token?: string }>({ parse: (v) => v })
  .run(async (input, { db }) => await db.users.findById(input.id))
  .build();

const createUser = r.task("createUser")
  .tags([httpRoute.with({ method: "POST", path: "/users" })])
  .inputSchema<{ name: string; email: string }>({ parse: (v) => v })
  .run(async (input, { db }) => await db.users.create(input))
  .build();
```

### Auto-Register Routes
```ts
import express from "express";
import { globals } from "@bluelibs/runner";

const httpServer = r.resource("server")
  .configSchema<{ port: number }>({ parse: (v) => v })
  .dependencies({ store: globals.resources.store })
  .init(async (config, { store }) => {
    const app = express();
    app.use(express.json());

    const routes = store.getTasksWithTag(httpRoute);

    for (const { definition, config: routeConfig } of routes) {
      const method = routeConfig.method.toLowerCase();
      app[method](routeConfig.path, async (req, res) => {
        try {
          const input = {
            ...req.params,
            ...req.query,
            ...req.body,
            token: req.headers.authorization?.replace("Bearer ", "")
          };
          const result = await store.runTask(definition, input);
          res.json(result);
        } catch (error) {
          res.status(error.statusCode || 500).json({ error: error.message });
        }
      });
    }

    const listener = app.listen(config.port);
    return { app, listener };
  })
  .dispose(async ({ listener }) => listener.close())
  .build();
```

## Event-Driven Architecture

```ts
// Event
const userRegistered = r.event("userRegistered")
  .payloadSchema<{ userId: string; email: string; name: string }>({ parse: (v) => v })
  .build();

// Main task
const registerUser = r.task("registerUser")
  .dependencies({ db, userRegistered })
  .inputSchema<{ email: string; name: string; password: string }>({ parse: (v) => v })
  .run(async (input, { db, userRegistered }) => {
    const user = await db.users.create({
      email: input.email,
      name: input.name,
      passwordHash: await hash(input.password)
    });

    await userRegistered({ userId: user.id, email: user.email, name: user.name });
    return user;
  })
  .build();

// Hooks (side effects)
const sendWelcomeEmail = r.hook("sendWelcomeEmail")
  .on(userRegistered)
  .dependencies({ emailService })
  .order(1)
  .run(async (event, { emailService }) => {
    await emailService.send({
      to: event.data.email,
      subject: "Welcome!",
      body: `Hello ${event.data.name}!`
    });
  })
  .build();

const createUserSettings = r.hook("createUserSettings")
  .on(userRegistered)
  .dependencies({ db })
  .order(2)
  .run(async (event, { db }) => {
    await db.settings.create({
      userId: event.data.userId,
      theme: "light",
      notifications: true
    });
  })
  .build();

const trackRegistration = r.hook("trackRegistration")
  .on(userRegistered)
  .dependencies({ analytics: analyticsService.optional() })
  .order(3)
  .run(async (event, { analytics }) => {
    if (analytics) {
      await analytics.track("user_registered", { userId: event.data.userId });
    }
  })
  .build();
```

## Database Integration

### PostgreSQL
```ts
import { Pool } from "pg";

const database = r.resource("db")
  .configSchema<{ connectionString: string; max?: number }>({ parse: (v) => v })
  .init(async (config) => {
    const pool = new Pool({
      connectionString: config.connectionString,
      max: config.max || 10
    });

    await pool.query("SELECT NOW()"); // Test connection

    return {
      query: (text: string, params?: any[]) => pool.query(text, params),
      pool
    };
  })
  .dispose(async ({ pool }) => await pool.end())
  .build();

// Usage
const getUser = r.task("getUser")
  .dependencies({ db: database })
  .run(async (userId: string, { db }) => {
    const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [userId]);
    return rows[0];
  })
  .build();
```

### MongoDB
```ts
import mongoose from "mongoose";

const mongoDb = r.resource("mongo")
  .configSchema<{ uri: string }>({ parse: (v) => v })
  .init(async (config) => {
    await mongoose.connect(config.uri);
    return mongoose.connection;
  })
  .dispose(async (connection) => await connection.close())
  .build();

const UserModel = r.resource("UserModel")
  .dependencies({ db: mongoDb })
  .init(async () => {
    return mongoose.model("User", new mongoose.Schema({
      name: String,
      email: { type: String, unique: true },
      createdAt: { type: Date, default: Date.now }
    }));
  })
  .build();
```

## Retry & Timeout

### Retry Middleware
```ts
const retryMiddleware = r.middleware.task("retry")
  .configSchema<{ attempts: number; backoff?: "linear" | "exponential"; initialDelay?: number }>({
    parse: (v) => v
  })
  .run(async ({ task, next }, _deps, config) => {
    let lastError: Error;

    for (let attempt = 0; attempt < config.attempts; attempt++) {
      try {
        return await next(task.input);
      } catch (err) {
        lastError = err;

        if (attempt < config.attempts - 1) {
          const delay = config.backoff === "exponential"
            ? (config.initialDelay || 100) * Math.pow(2, attempt)
            : (config.initialDelay || 100) * (attempt + 1);

          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  })
  .build();
```

### Timeout Middleware
```ts
const timeoutMiddleware = r.middleware.task("timeout")
  .configSchema<{ ms: number }>({ parse: (v) => v })
  .run(async ({ task, next }, _deps, config) => {
    return Promise.race([
      next(task.input),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${config.ms}ms`)), config.ms)
      )
    ]);
  })
  .build();

// Use together
const fetchData = r.task("fetchData")
  .middleware([
    retryMiddleware.with({ attempts: 3, backoff: "exponential", initialDelay: 100 }),
    timeoutMiddleware.with({ ms: 5000 })
  ])
  .run(async (url: string) => { /* fetch */ })
  .build();
```

## Rate Limiting

```ts
const rateLimitMiddleware = r.middleware.task("rateLimit")
  .configSchema<{ maxRequests: number; windowMs: number; keyFn?: (input: any) => string }>({
    parse: (v) => v
  })
  .context(() => ({
    buckets: new Map<string, { tokens: number; lastRefill: number }>()
  }))
  .run(async ({ task, next }, _deps, config, ctx) => {
    const key = config.keyFn ? config.keyFn(task.input) : "global";
    let bucket = ctx.buckets.get(key);
    const now = Date.now();

    if (!bucket) {
      bucket = { tokens: config.maxRequests, lastRefill: now };
      ctx.buckets.set(key, bucket);
    }

    // Refill tokens
    const timePassed = now - bucket.lastRefill;
    const tokensToAdd = Math.floor((timePassed / config.windowMs) * config.maxRequests);

    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(config.maxRequests, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }

    if (bucket.tokens < 1) throw new Error("Rate limit exceeded");

    bucket.tokens--;
    return next(task.input);
  })
  .build();

// User-specific rate limiting
const createPost = r.task("createPost")
  .middleware([
    jwtAuth.with({ secret: process.env.JWT_SECRET }),
    rateLimitMiddleware.with({
      maxRequests: 10,
      windowMs: 60000,
      keyFn: (input) => input.userId
    })
  ])
  .run(async (input, { authContext, db }) => {
    const auth = authContext.use();
    return await db.posts.create({ ...input, userId: auth.userId });
  })
  .build();
```

## Distributed Systems with Tunnels

### Server (Expose Tasks)
```ts
import { nodeExposure } from "@bluelibs/runner/node";

const serverApp = r.resource("server")
  .register([
    nodeExposure.with({
      http: {
        basePath: "/__runner",
        listen: { host: "0.0.0.0", port: 7070 },
        auth: { token: process.env.RUNNER_TOKEN }
      }
    }),

    getUserTask,
    createUserTask,
    processOrderTask
  ])
  .build();

await run(serverApp);
```

### Client (Call Remote Tasks)
```ts
import { globals } from "@bluelibs/runner";

const tunnelClient = r.resource("tunnel")
  .tags([globals.tags.tunnel])
  .init(async () => ({
    mode: "client" as const,
    transport: "http" as const,
    tasks: (task) => task.id.startsWith("remote."),
    client: globals.tunnels.http.createClient({
      url: process.env.REMOTE_URL,
      auth: { token: process.env.RUNNER_TOKEN }
    })
  }))
  .build();

const clientApp = r.resource("client")
  .register([
    tunnelClient,

    r.task("processOrder")
      .dependencies({ remoteGetUser: remote_getUserTask })
      .run(async (orderId, { remoteGetUser }) => {
        const user = await remoteGetUser(orderId.userId);
        // Process with remote user data
      })
      .build()
  ])
  .build();
```

## Graceful Shutdown

```ts
const server = r.resource("server")
  .configSchema<{ port: number; shutdownTimeout?: number }>({ parse: (v) => v })
  .context(() => ({ activeConnections: new Set() }))
  .init(async (config, _deps, ctx) => {
    const app = express();
    const server = app.listen(config.port);

    server.on("connection", (conn) => {
      ctx.activeConnections.add(conn);
      conn.on("close", () => ctx.activeConnections.delete(conn));
    });

    return { app, server };
  })
  .dispose(async ({ server }, _deps, config, ctx) => {
    server.close(); // Stop accepting new connections

    const timeout = config.shutdownTimeout || 10000;
    const start = Date.now();

    while (ctx.activeConnections.size > 0) {
      if (Date.now() - start > timeout) {
        ctx.activeConnections.forEach(conn => conn.destroy());
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  })
  .build();

// Run with shutdown hooks
await run(app, { shutdownHooks: true, errorBoundary: true });
```

## Logging

```ts
import winston from "winston";

const logger = r.resource("logger")
  .init(async () => {
    return winston.createLogger({
      level: process.env.LOG_LEVEL || "info",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: "app.log" })
      ]
    });
  })
  .build();

const loggingMiddleware = r.middleware.task("logging")
  .dependencies({ logger })
  .everywhere(() => true)
  .run(async ({ task, next }, { logger }) => {
    const start = Date.now();

    logger.info({ event: "task_start", taskId: task.definition.id, input: task.input });

    try {
      const result = await next(task.input);
      logger.info({ event: "task_complete", taskId: task.definition.id, duration: Date.now() - start });
      return result;
    } catch (error) {
      logger.error({ event: "task_error", taskId: task.definition.id, error: error.message, duration: Date.now() - start });
      throw error;
    }
  })
  .build();
```

## Implementation Checklist

- ✅ Define interfaces and contracts first
- ✅ Write acceptance criteria
- ✅ Use fluent builders (`r.*`)
- ✅ Add proper TypeScript types
- ✅ Write tests alongside implementation
- ✅ Add middleware for cross-cutting concerns
- ✅ Use events for decoupling
- ✅ Handle errors gracefully
- ✅ Add logging/observability
- ✅ Verify 100% test coverage
- ✅ Update AI.md and README.md if needed

## Common Patterns Summary

| Feature | Primary Tools |
|---------|---------------|
| Authentication | `r.middleware.task()`, `r.asyncContext()` |
| Caching | `r.middleware.task()`, `.context()` |
| HTTP APIs | `r.tag()`, `globals.resources.store` |
| Event-Driven | `r.event()`, `r.hook()` |
| Database | `r.resource()`, `.dispose()` |
| Retry/Timeout | `r.middleware.task()` |
| Rate Limiting | `r.middleware.task()`, `.context()` |
| Distributed | `nodeExposure`, `createHttpClient` |
| Logging | `r.middleware.task()`, `r.resource()` |

## Resources

- readmes/COOKBOOK.md - More patterns
- readmes/TUNNELS.md - Distributed systems
- readmes/MIDDLEWARE.md - Middleware guide
- examples/ - Real applications
