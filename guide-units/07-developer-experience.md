## Async Context

Ever needed to pass a request ID, user session, or trace ID through your entire call stack without threading it through every function parameter? That's what Async Context does.

It gives you **request-scoped state** that automatically flows through your async operations—no prop drilling required.

> **Platform Note**: Async Context uses Node.js's `AsyncLocalStorage` under the hood, so it's **Node.js-only**. For browsers, pass context explicitly through parameters instead.

### When to use it

- **Request tracing**: Carry a `requestId` or `traceId` through all operations
- **User sessions**: Access the current user without passing it everywhere
- **Database transactions**: Share a transaction across multiple operations
- **Logging context**: Automatically include request metadata in all logs

### Basic usage

```typescript
import { r, run } from "@bluelibs/runner";

// 1. Define your context shape
const requestContext = r
  .asyncContext<{ requestId: string; userId?: string }>("app.ctx.request")
  .build();

// 2. Wrap your request handler
async function handleRequest(req: Request) {
  await requestContext.provide({ requestId: crypto.randomUUID() }, async () => {
    // Everything inside here can access the context
    await processRequest(req);
  });
}

// 3. Read from anywhere in the call stack
async function processRequest(req: Request) {
  const ctx = requestContext.use(); // { requestId: "abc-123", userId: undefined }
  console.log(`Processing request ${ctx.requestId}`);
}
```

### Using context in tasks

The real power comes when you use context inside your tasks:

```typescript
const auditLog = r
  .task("app.tasks.auditLog")
  .dependencies({ requestContext, logger: globals.resources.logger })
  .run(async (message: string, { requestContext, logger }) => {
    const ctx = requestContext.use();
    await logger.info(message, {
      requestId: ctx.requestId,
      userId: ctx.userId,
    });
  })
  .build();

// Register the context alongside your tasks
const app = r.resource("app").register([requestContext, auditLog]).build();
```

### Requiring context with middleware

Force tasks to run only within a context boundary:

```typescript
const securedTask = r
  .task("app.tasks.secured")
  .middleware([requestContext.require()]) // Throws if context not provided
  .run(async (input) => {
    const ctx = requestContext.use(); // Guaranteed to exist
    return { processedBy: ctx.userId };
  })
  .build();
```

### Custom serialization

By default, Runner preserves Dates, RegExp, and other types across async boundaries. For custom serialization:

```typescript
const sessionContext = r
  .asyncContext<{ user: User }>("app.ctx.session")
  .serialize((data) => JSON.stringify(data))
  .parse((raw) => JSON.parse(raw))
  .build();
```

> **runtime:** "Async Context: your data playing hide-and-seek across the event loop. One forgotten `.provide()` and the 'Context not available' error will find you at 3am, exactly where your stack trace is least helpful."
## Fluent Builders (`r.*`)

The `r` namespace gives you a chainable, discoverable way to build Runner components. Instead of memorizing object shapes, you get autocomplete that guides you through the options.

### Why use fluent builders?

```typescript
// Classic API - you need to know the shape
const classicTask = task({
  id: "users.create",
  dependencies: { db },
  inputSchema: userSchema,
  run: async (input, { db }) => {
    /* ... */
  },
});

// Fluent API - autocomplete guides you
const fluentTask = r
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

// Assuming: createConnection() and UserData are your own implementations
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
import { r, globals } from "@bluelibs/runner";
import { z } from "zod";

// Assuming: userRepo was defined in the "Building resources" section above
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
import { r } from "@bluelibs/runner";

// Assuming: mailer is a resource defined elsewhere
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

### Builder Chaining Semantics (Append vs Replace)

Repeated calls are part of the design, but not every method composes the same way.

- **Replace (last call wins):** Scalar/single-value setters like `.run()`, `.init()`, `.schema()`, `.inputSchema()`, `.resultSchema()`, `.meta()`, `.order()`, `.parallel()`, `.context()`, `.dispose()`, `.httpCode()`, `.format()`, and `.remediation()`.
- **Append by default, replace with `{ override: true }`:** List-like methods such as `.tags()`, `.middleware()`, and (resources) `.register()`, `.overrides()`, `.exports()`.
- **Shallow-merge by default, replace with `{ override: true }`:** `.dependencies()`.
- **Additive-only merge (no override flag):** Resource `.wiringAccessPolicy()` accumulates `deny`/`only` entries across calls.

Two important exceptions:

- Repeated `.throws()` calls currently **replace** the previous declaration (last call wins). We keep this behavior for compatibility.
- `event.throws()` is documentation-only (events themselves don't throw during emit), so it does not behave like task/resource `.throws()`.

The same chaining rules apply when using `r.override(base)` fluent override builders.

For the complete API reference, see the [Fluent Builders documentation](../readmes/FLUENT_BUILDERS.md).

> **runtime:** "Fluent builders: method chaining dressed up for a job interview. You type a dot and I whisper possibilities. It's the same definition either way—I just appreciate the ceremony."
## Type Helpers

When you need to reference a task's input type in another function, or pass a resource's value type to a generic, these utility types save you from re-declaring the same shapes.

### Extracting types from components

```typescript
import { r } from "@bluelibs/runner";
import type {
  ExtractTaskInput,
  ExtractTaskOutput,
  ExtractResourceConfig,
  ExtractResourceValue,
  ExtractEventPayload,
} from "@bluelibs/runner";

// Define your components
const createUser = r
  .task("users.create")
  .run(async (input: { name: string; email: string }) => ({
    id: "user-123",
    ...input,
  }))
  .build();

const database = r
  .resource<{ connectionString: string }>("app.db")
  .init(async (cfg) => createConnection(cfg.connectionString))
  .build();

const userCreated = r
  .event<{ userId: string; email: string }>("users.created")
  .build();

// Extract types without re-declaring them
type CreateUserInput = ExtractTaskInput<typeof createUser>; // { name: string; email: string }
type CreateUserOutput = ExtractTaskOutput<typeof createUser>; // { id: string; name: string; email: string }
type DbConfig = ExtractResourceConfig<typeof database>; // { connectionString: string }
type DbValue = ExtractResourceValue<typeof database>; // Connection
type UserCreatedPayload = ExtractEventPayload<typeof userCreated>; // { userId: string; email: string }
```

### Practical use cases

**Building API handlers that match task signatures:**

```typescript
// Your task defines the contract
const processOrder = r
  .task("orders.process")
  .run(async (input: { orderId: string; priority: "low" | "high" }) => ({
    status: "processed" as const,
    orderId: input.orderId,
  }))
  .build();

// Your HTTP handler enforces the same types
type OrderInput = ExtractTaskInput<typeof processOrder>;
type OrderOutput = ExtractTaskOutput<typeof processOrder>;

// Assuming: expressApp is an Express instance
// Assuming: runTask is from `const { runTask } = await run(app)`
expressApp.post("/orders", async (req, res) => {
  const input: OrderInput = req.body; // Type-checked!
  const result: OrderOutput = await runTask(processOrder, input);
  res.json(result);
});
```

**Creating wrapper functions:**

```typescript
import type { ITask } from "@bluelibs/runner";

// A logging wrapper that preserves the task's `run()` signature
function withLogging<T extends ITask<any, Promise<any>, any>>(task: T) {
  return (...args: Parameters<T["run"]>): ReturnType<T["run"]> => {
    const [input] = args;
    console.log(`Calling ${task.id}`, input);
    return task.run(...args).then((value) => {
      console.log(`Result from ${task.id}`, value);
      return value;
    });
  };
}
```

### Quick reference

| Helper                     | Extracts         | From     |
| -------------------------- | ---------------- | -------- |
| `ExtractTaskInput<T>`      | Input type       | Task     |
| `ExtractTaskOutput<T>`     | Return type      | Task     |
| `ExtractResourceConfig<T>` | Config parameter | Resource |
| `ExtractResourceValue<T>`  | Init return type | Resource |
| `ExtractEventPayload<T>`   | Payload type     | Event    |

> **runtime:** "Type helpers: TypeScript's 'I told you so' toolkit. You extract the input type from a task, slap it on an API handler, and suddenly your frontend and backend are sworn blood brothers. Until someone uses `as any`. Then I cry."

## Runner Dev Tools Quick Start

Runner Dev Tools (`@bluelibs/runner-dev`) turns your runtime into an inspectable, queryable, and scriptable system while your app is running.

If Runner gives you explicit wiring, Runner Dev Tools gives you visibility and control over that wiring in real time.

### Why teams use it

- **Visual DevTools UI**: inspect topology, call tasks, emit events, and debug behavior from the browser
- **GraphQL introspection API**: query tasks/resources/events/middleware/dependencies programmatically
- **Live telemetry**: stream logs, emissions, errors, and task runs with correlation-aware diagnostics
- **Scaffolding CLI**: bootstrap projects and generate resources/tasks/events/tags/middleware quickly
- **Dry-run query mode**: introspect local TypeScript entry files without running a server
- **MCP server mode**: let AI tools query your runtime safely through a standard protocol
- **Hot-swap debugging (dev-focused)**: replace task run functions temporarily to investigate edge cases quickly

### Install

```bash
npm install -g @bluelibs/runner-dev
# or run without global install
npx @bluelibs/runner-dev --help
```

### Common CLI commands

```bash
# Scaffold a new Runner project
runner-dev new my-app --install

# Scaffold a task artifact
runner-dev new task create-user --ns app.users --dir src --export

# Query a local TypeScript entry in dry-run mode (no server)
runner-dev query 'query { tasks { id } }' --entry-file ./src/main.ts

# Generate a runtime overview from a live endpoint
ENDPOINT=http://localhost:1337/graphql runner-dev overview --details 10

# Start MCP bridge for AI tooling
ENDPOINT=http://localhost:1337/graphql npx -y @bluelibs/runner-dev mcp
```

### Runtime integration

Register `dev` in your app to expose the Dev UI and GraphQL endpoint:

```ts
import { r } from "@bluelibs/runner";
import { dev } from "@bluelibs/runner-dev";

const app = r
  .resource("app")
  .register([
    dev.with({
      port: 1337,
      maxEntries: 1000,
    }),
  ])
  .build();
```

When running, open `http://localhost:1337` for the visual DevTools.

> **Note:** Runner Dev Tools is intended for development and controlled environments. Treat it as privileged operational access.
