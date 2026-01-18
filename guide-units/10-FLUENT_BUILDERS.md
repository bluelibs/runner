## Fluent Builders (`r.*`)

The `r` namespace gives you a chainable, discoverable way to build Runner components. Instead of memorizing object shapes, you get autocomplete that guides you through the options.

### Why use fluent builders?

```typescript
// Classic API - you need to know the shape
const task = task({
  id: "users.create",
  dependencies: { db },
  inputSchema: userSchema,
  run: async (input, { db }) => {
    /* ... */
  },
});

// Fluent API - autocomplete guides you
const task = r
  .task("users.create") // Start here, then...
  .dependencies({ db }) // ...chain what you need
  .inputSchema(userSchema)
  .run(async (input, { db }) => {
    /* ... */
  })
  .build();
```

Both produce identical runtime definitions. The fluent API just makes discovery easier.

### Building resources

Resources are singletons with lifecycle management. Here's the progression from simple to complete:

```typescript
import { r, run } from "@bluelibs/runner";

// Simple: just returns a value
const config = r
  .resource("app.config")
  .init(async () => ({ apiUrl: process.env.API_URL }))
  .build();

// With config: accepts parameters via .with()
const database = r
  .resource<{ connectionString: string }>("app.db")
  .init(async ({ connectionString }) => createConnection(connectionString))
  .dispose(async (connection) => connection.close())
  .build();

// With dependencies: uses other resources
const userRepo = r
  .resource("app.repos.user")
  .dependencies({ database })
  .init(async (_config, { database }) => ({
    findById: (id: string) =>
      database.query("SELECT * FROM users WHERE id = ?", id),
    create: (data: UserData) => database.query("INSERT INTO users ...", data),
  }))
  .build();

// Wire it all together
const app = r
  .resource("app")
  .register([
    database.with({ connectionString: "postgres://localhost/myapp" }),
    userRepo,
  ])
  .build();

await run(app);
```

### Building tasks

Tasks are your business logic with DI, middleware, and validation:

```typescript
const createUser = r
  .task("users.create")
  .dependencies({ userRepo, logger: globals.resources.logger })
  .inputSchema(
    z.object({
      name: z.string().min(2),
      email: z.string().email(),
    }),
  )
  .middleware([globals.middleware.task.retry.with({ retries: 3 })])
  .run(async (input, { userRepo, logger }) => {
    await logger.info("Creating user", { email: input.email });
    return userRepo.create(input);
  })
  .build();
```

### Building events and hooks

```typescript
// Events are typed signals
const userCreated = r
  .event<{ userId: string; email: string }>("users.created")
  .build();

// Hooks react to events
const sendWelcome = r
  .hook("users.sendWelcome")
  .on(userCreated)
  .dependencies({ mailer })
  .run(async (event, { mailer }) => {
    await mailer.send(event.data.email, "Welcome!");
  })
  .build();
```

### The pattern

Every builder follows the same rhythm:

1. **Start** with `r.task()`, `r.resource()`, `r.event()`, etc.
2. **Configure** with `.dependencies()`, `.middleware()`, `.tags()`, etc.
3. **Implement** with `.run()` or `.init()`
4. **Finish** with `.build()`

For the complete API reference, see the [Fluent Builders documentation](./readmes/FLUENT_BUILDERS.md).

> **runtime:** "Fluent builders: method chaining dressed up for a job interview. You type a dot and I whisper possibilities. It's the same definition either way—I just appreciate the ceremony."
