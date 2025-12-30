---
name: runner-expert
description: Use when user asks about Runner concepts (tasks, resources, events, middleware, tags), fluent builder API (r.*), dependency injection patterns, asks 'how do I create/use X in Runner', architecture questions, or needs implementation guidance for BlueLibs Runner DI framework
---

# Runner Expert Skill

Runner is a TypeScript DI framework: functions over classes, no decorators, full type inference, fluent builders (`r.*`).

## Core Philosophy

- **Tasks** = async functions with DI, middleware, validation
- **Resources** = singletons (db, services, config)
- **Events** = decoupled communication
- **Hooks** = event listeners
- **Middleware** = cross-cutting concerns
- **100% test coverage required**

## The Big Five

### 1. Resources (Singletons)
```ts
const db = r
  .resource("db")
  .init(async () => new Database())
  .dispose(async (db) => db.close())
  .build();
```

### 2. Tasks (Business Operations)
```ts
const createUser = r
  .task("app.tasks.createUser")
  .dependencies({ db, logger })
  .inputSchema<{ name: string }>({ parse: (v) => v })
  .middleware([loggingMiddleware])
  .run(async (input, { db, logger }) => {
    // Implementation
  })
  .build();
```

**When to use tasks:**
- High-level business operations
- Need observability/middleware
- Used from multiple places

**When NOT to use:**
- Simple utilities
- Performance-critical (<1ms)
- Pure computations

### 3. Events
```ts
const userRegistered = r
  .event("app.events.userRegistered")
  .payloadSchema<{ userId: string; email: string }>({ parse: (v) => v })
  .build();

// Emit
await deps.userRegistered({ userId: "123", email: "user@example.com" });
```

### 4. Hooks
```ts
const sendWelcome = r
  .hook("app.hooks.sendWelcome")
  .on(userRegistered)
  .order(1) // Lower runs first
  .dependencies({ mailer })
  .run(async (event, { mailer }) => {
    await mailer.send({ to: event.data.email });
    // event.stopPropagation() to cancel downstream
  })
  .build();
```

### 5. Middleware
```ts
const auditMiddleware = r.middleware
  .task("app.middleware.audit")
  .dependencies({ logger })
  .everywhere((task) => task.id.startsWith("app."))
  .run(async ({ task, next }, { logger }) => {
    logger.info(`→ ${task.definition.id}`);
    const result = await next(task.input);
    logger.info(`← ${task.definition.id}`);
    return result;
  })
  .build();
```

## Fluent Builder API

**Always use `r.*` for new code:**

```ts
r.resource("id").init(...).build()
r.task("id").dependencies({...}).run(...).build()
r.event("id").payloadSchema(...).build()
r.hook("id").on(event).run(...).build()
r.middleware.task("id").run(...).build()
r.tag("id").configSchema(...).build()
r.asyncContext<T>("id").build()
r.error<T>("id").dataSchema(...).build()
```

**Configuration with `.with()`:**
```ts
const server = httpServer.with({ port: 3000 });
const cached = myTask.with({ ttl: 60000 });
```

## Dependency Injection

### Basic
```ts
.dependencies({ db, logger })
.run(async (input, { db, logger }) => { ... })
```

### Optional
```ts
.dependencies({ analytics: analyticsService.optional() })
.run(async (input, { analytics }) => {
  if (analytics) await analytics.track(input);
})
```

### Dynamic
```ts
.dependencies((config) => ({
  service: config.useCache ? cachedService : directService
}))
```

### Globals
```ts
import { globals } from "@bluelibs/runner";

globals.resources.logger
globals.resources.store
globals.resources.serializer
globals.resources.httpClientFactory

globals.middleware.task.cache
globals.middleware.task.timeout
globals.middleware.task.retry
```

## Registration & Run

```ts
const app = r
  .resource("app")
  .register([
    db,
    logger,
    createUser,
    userRegistered,
    sendWelcome,
    authMiddleware,
    server.with({ port: 3000 })
  ])
  .build();

const runtime = await run(app, {
  debug: "verbose",
  shutdownHooks: true,
  errorBoundary: true
});

// Use runtime
await runtime.runTask(createUser, { name: "Ada" });
await runtime.dispose();
```

## Common Patterns

### Express Integration
```ts
const server = r
  .resource("server")
  .dependencies({ getUser })
  .init(async (config, { getUser }) => {
    const app = express();
    app.get('/users/:id', async (req, res) => {
      res.json(await getUser(req.params.id));
    });
    return app.listen(config.port);
  })
  .dispose(async (server) => server.close())
  .build();
```

### Caching
```ts
.middleware([globals.middleware.task.cache.with({ ttl: 60000 })])
```

### Retry & Timeout
```ts
.middleware([
  globals.middleware.task.retry.with({ attempts: 3 }),
  globals.middleware.task.timeout.with({ ms: 5000 })
])
```

### Tag-Based Discovery
```ts
const httpRoute = r.tag("app.tags.httpRoute")
  .configSchema<{ method: string; path: string }>({ parse: (v) => v })
  .build();

const getHealth = r.task("app.tasks.getHealth")
  .tags([httpRoute.with({ method: "GET", path: "/health" })])
  .run(async () => ({ status: "ok" }))
  .build();

// Discover
const routes = store.getTasksWithTag(httpRoute);
```

### Async Context
```ts
const requestContext = r.asyncContext<{ requestId: string }>("request").build();

// Provide
await requestContext.provide({ requestId: "abc" }, async () => {
  const ctx = requestContext.use(); // { requestId: "abc" }
});

// Or inject
.dependencies({ requestContext })
.run(async (input, { requestContext }) => {
  const ctx = requestContext.use();
})
```

## Testing

**100% coverage mandatory**

```ts
test("creates user", async () => {
  const app = r.resource("test.app")
    .register([db.with({ connection: mockDb }), createUser])
    .build();

  const { runTask, dispose } = await run(app);
  const user = await runTask(createUser, { name: "Ada" });

  expect(user.name).toBe("Ada");
  await dispose();
});
```

**Commands:**
- `npm run coverage:ai` - Full coverage report (token-friendly)
- `npm run test -- searchKey` - Focused tests

## Error Handling

```ts
const AppError = r.error<{ code: number; message: string }>("AppError")
  .dataSchema({ parse: (v) => v })
  .build();

try {
  AppError.throw({ code: 400, message: "Bad request" });
} catch (err) {
  if (AppError.is(err)) {
    console.log(err.data.code); // 400
  }
}
```

## Common Mistakes

❌ Missing `.build()`:
```ts
const task = r.task("task").run(...); // Error!
```

✅ Always `.build()`:
```ts
const task = r.task("task").run(...).build();
```

❌ Tasks for utilities:
```ts
const add = r.task("add").run(async (a, b) => a + b).build();
```

✅ Plain functions:
```ts
const add = (a: number, b: number) => a + b;
```

❌ Ignoring coverage:
```ts
coveragePathIgnorePatterns: ["hard-file.ts"] // Never do this!
```

## File Organization

- Node-specific: `./src/node/`
- Platform-agnostic: `./src/`
- See `readmes/MULTIPLATFORM.md`

**Code quality:**
- Descriptive names
- Comments explain "why"
- Small functions (<200 lines)
- Few arguments (<3)

## Performance

- Tasks: ~2.2M ops/sec baseline, ~244K/sec with 5 middleware
- Use tasks for business logic, functions for utilities

## Debugging

```ts
await run(app, { debug: "verbose" });
```

## Resources

- README.md - Full documentation
- AI.md - Token-friendly guide
- readmes/CONCEPTS.md - Core concepts
- readmes/COOKBOOK.md - Patterns
- readmes/TESTING.md - Testing guide
