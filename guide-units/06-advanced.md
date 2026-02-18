## Advanced Patterns

This section covers patterns for building resilient, distributed applications. Use these when your app grows beyond a single process or needs to handle partial failures gracefully.

---

## Optional Dependencies

Optional dependencies are for components that may not be registered in a given runtime (for example local dev, feature-flagged modules, or partial deployments).
They are not a substitute for retry/circuit-breaker logic when a registered dependency fails at runtime.

### The problem

```typescript
// Without optional dependencies - if analytics is not registered, startup fails
const registerUser = r
  .task("app.tasks.registerUser")
  .dependencies({ database, analytics }) // analytics must be available!
  .run(async (input, { database, analytics }) => {
    const user = await database.create(input);
    await analytics.track("user.registered");
    return user;
  })
  .build();
```

### The solution

```typescript
import { r } from "@bluelibs/runner";

const registerUser = r
  .task("app.tasks.registerUser")
  .dependencies({
    database, // Required - task fails if missing
    analytics: analyticsService.optional(), // Optional - undefined if missing
    email: emailService.optional(), // Optional - graceful degradation
  })
  .run(async (input, { database, analytics, email }) => {
    // Core logic always runs
    const user = await database.create(input);

    // Optional dependencies are undefined if missing
    await analytics?.track("user.registered");
    await email?.sendWelcome(user.email);

    return user;
  })
  .build();
```

Important: `optional()` handles dependency absence (`undefined`) at wiring time.
If a registered dependency throws, handle that with retry/fallback/circuit-breaker patterns.

### When to use optional dependencies

| Use Case                  | Example                                            |
| ------------------------- | -------------------------------------------------- |
| **Non-critical services** | Analytics, metrics, feature flags                  |
| **External integrations** | Third-party APIs that may be flaky                 |
| **Development shortcuts** | Skip services not running locally                  |
| **Feature toggles**       | Conditionally enable functionality                 |
| **Gradual rollouts**      | New services that might not be deployed everywhere |

### Dynamic dependencies

For components that accept config (like resources), you can compute dependencies from `.with(...)` config:

```typescript
const analyticsAdapter = r
  .resource<{ enableAnalytics?: boolean }>("app.services.analyticsAdapter")
  .dependencies((config) => ({
    database,
    // Only include analytics when enabled in resource config
    ...(config?.enableAnalytics ? { analytics } : {}),
  }))
  .init(async (_config, deps) => ({
    async record(eventName: string) {
      await deps.analytics?.track(eventName);
    },
  }))
  .build();
```

For tasks, prefer static dependencies (required or `.optional()`) and branch at execution time.

---

## Execution Journal (Advanced Coordination)

When multiple middleware need to exchange execution-local state without polluting task input/output, use the **ExecutionJournal**.

- Use typed keys via `journal.createKey<T>(...)`
- `set()` is fail-fast by default (duplicate key writes throw)
- Use `{ override: true }` only when mutation is intentional
- Forward journal explicitly in nested task calls when you need shared trace/state continuity

For the full API and patterns, see the Execution Journal section in [Core Concepts](./02-core-concepts.md#execution-journal).

---

## Task Interceptors

Task interceptors let a resource surgically wrap a specific dependency task at init time:

```typescript
const installer = r
  .resource("app.installer")
  .dependencies({ taskA })
  .init(async (_config, { taskA }) => {
    taskA.intercept(async (next, input) => {
      const result = await next(input);
      return { ...result, intercepted: true };
    });
  })
  .build();
```

Use this when behavior should be scoped to a particular wiring path, not globally.

For deeper lifecycle guidance, see [Runtime Lifecycle](./03-runtime-lifecycle.md#task-interceptors).

---

## Durable Workflows (Node-only)

Durable workflows provide replay-safe, crash-recoverable orchestration primitives:

- `ctx.step(...)` for deterministic checkpoints
- `ctx.sleep(...)` for durable timers
- `ctx.waitForSignal(...)` for durable external synchronization
- `ctx.switch(...)` for replay-safe branching

Use them when business processes must survive process restarts and resume correctly.

See [Durable Workflows](../readmes/DURABLE_WORKFLOWS.md) for complete API and patterns.

---

## Serialization

Ever sent a `Date` over JSON and gotten `"2024-01-15T..."` back as a string? Runner's serializer preserves types across the wire.
It also supports object graphs that plain JSON cannot represent, including circular and self-referencing objects.

### What it handles

| Type          | JSON   | Runner Serializer |
| ------------- | ------ | ----------------- |
| `Date`        | String | Date object       |
| `RegExp`      | Lost   | RegExp object     |
| `Map`, `Set`  | Lost   | Preserved         |
| `Uint8Array`  | Lost   | Preserved         |
| Circular refs | Error  | Preserved         |
| Self refs     | Error  | Preserved         |

### Two modes

```typescript
import { Serializer } from "@bluelibs/runner";

const serializer = new Serializer();

// Tree mode - like JSON.stringify, but type-aware
const json = serializer.stringify({ when: new Date(), pattern: /hello/i });
const obj = serializer.parse(json);
// obj.when is a Date, obj.pattern is a RegExp

// Graph mode - handles circular and self references
const user = { name: "Alice" };
const team = { members: [user], lead: user }; // shared reference
user.team = team; // circular reference
team.self = team; // self reference

const data = serializer.serialize(team);
const restored = serializer.deserialize(data);
// restored.members[0] === restored.lead (same object!)
// restored.self === restored (self-reference preserved)
```

### Custom types

Teach the serializer about your own classes:

```typescript
class Money {
  constructor(
    public amount: number,
    public currency: string,
  ) {}
}

// Register the type
serializer.addType({
  id: "Money",
  is: (obj): obj is Money => obj instanceof Money,
  serialize: (money) => ({ amount: money.amount, currency: money.currency }),
  deserialize: (json) => new Money(json.amount, json.currency),
  strategy: "value",
});

// Now it round-trips correctly
const price = new Money(99.99, "USD");
const json = serializer.stringify({ price });
const { price: restored } = serializer.parse(json);
// restored instanceof Money === true
```

### Security features

The serializer is hardened against common attacks:

- **ReDoS protection**: Validates RegExp patterns against catastrophic backtracking
- **Prototype pollution blocked**: Filters `__proto__`, `constructor`, `prototype` keys
- **Depth limits**: Configurable max depth prevents stack overflow

> **Note:** File uploads use the tunnel layer's multipart handling, not the serializer. See [Tunnels](../readmes/TUNNELS.md) for file upload patterns.

### Tunnels: Bridging Runners

Tunnels are a powerful feature for building distributed systems. They let you expose your tasks and events over HTTP, making them callable from other processes, services, or even a browser UI. This allows a server and client to co-exist, enabling one Runner instance to securely call another.

Here's a sneak peek of how you can expose your application and configure a client tunnel to consume a remote Runner:

```typescript
import { r, globals } from "@bluelibs/runner";
import { nodeExposure } from "@bluelibs/runner/node";

let app = r.resource("app");

if (process.env.SERVER) {
  // 1. Expose your local tasks and events over HTTP, only when server mode is active.
  app.register([
    // ... your tasks and events
    nodeExposure.with({
      http: {
        basePath: "/__runner",
        listen: { port: 7070 },
      },
    }),
  ]);
}
app = app.build();

// 2. In another app, define a tunnel resource to call a remote Runner
const remoteTasksTunnel = r
  .resource("app.tunnels.http")
  .tags([globals.tags.tunnel])
  .dependencies({ createClient: globals.resources.httpClientFactory })
  .init(async (_, { createClient }) => ({
    mode: "client", // or "server", or "none", or "both" for emulating network infrastructure
    transport: "http", // the only one supported for now
    // Selectively forward tasks starting with "remote.tasks."
    tasks: (t) => t.id.startsWith("remote.tasks."),
    client: createClient({
      url: "http://remote-runner:8080/__runner",
    }),
  }))
  .build();
```

This is just a glimpse. With tunnels, you can build microservices, CLIs, and admin panels that interact with your main application securely and efficiently.

For a deep dive into streaming, authentication, file uploads, and more, check out the [full Tunnels documentation](../readmes/TUNNELS.md).

---

## Resilience Orchestration

In production, one resilience strategy is rarely enough. Runner allows you to compose multiple middlewares into a "resilience onion" that protects your business logic from multiple failure modes.

### The Problem

A task that calls a remote API might fail due to network blips (needs **Retry**), hang indefinitely (needs **Timeout**), slam the API during traffic spikes (needs **Rate Limit**), or keep failing if the API is down (needs **Circuit Breaker**).

### The Solution

Combine them in the correct order. Like an onion, the outer layers handle broader concerns, while inner layers handle specific execution details.

```typescript
import { r, globals } from "@bluelibs/runner";

const resilientTask = r
  .task("app.tasks.ultimateResilience")
  .middleware([
    // Outer layer: Fallback (the absolute Plan B if everything below fails)
    globals.middleware.task.fallback.with({
      fallback: { status: "offline-mode", data: [] },
    }),

    // Next: Rate Limit (check this before wasting resources or retry budget)
    globals.middleware.task.rateLimit.with({ windowMs: 60000, max: 100 }),

    // Next: Circuit Breaker (stop immediately if the service is known to be down)
    globals.middleware.task.circuitBreaker.with({ failureThreshold: 5 }),

    // Next: Retry (wrap the attempt in a retry loop)
    globals.middleware.task.retry.with({ retries: 3 }),

    // Inner layer: Timeout (enforce limit on EACH individual attempt)
    globals.middleware.task.timeout.with({ ttl: 5000 }),
  ])
  .run(async () => {
    return await fetchDataFromUnreliableSource();
  })
  .build();
```

### Best practices for orchestration

1.  **Rate Limit first**: Don't even try to execute or retry if you've exceeded your quota.
2.  **Circuit Breaker second**: Don't retry against a service that is known to be failing.
3.  **Retry wraps Timeout**: Ensure the timeout applies to the _individual_ attempt, so the retry logic can kick in when one attempt hangs.
4.  **Fallback last**: The fallback should be the very last thing that happens if the entire resilience stack fails.

> **runtime:** "Resilience Orchestration: layering defense-in-depth like a paranoid onion. I'm counting your turns, checking the circuit, spinning the retry wheel, and holding a stopwatch—all so you can sleep through a minor server fire."

## Meta

Think about generating API documentation automatically from your tasks, or building an admin dashboard that shows what each task does without reading code. Or you need to categorize tasks by feature for billing purposes. How do you attach descriptive information to components?

**The problem**: You need to document what components do and categorize them, but there's no standard place to store this metadata.

**The naive solution**: Use naming conventions or external documentation. But this gets out of sync easily and doesn't integrate with tooling.

**The better solution**: Use Meta, a structured way to describe what your components do.

### When to use Meta

| Use case | Why Meta helps |
|----------|---------------|
| API docs | Generate documentation from component metadata |
| Admin dashboards | Display component descriptions |
| Billing | Categorize tasks by feature for metering |
| Discovery | Search components by title/description |

### Metadata Properties

Every component can have these basic metadata properties:

```typescript
interface IMeta {
  title?: string; // Human-readable name
  description?: string; // What this component does
  tags?: TagType[]; // Categories and behavioral flags
}
```

### Simple Documentation Example

```typescript
const userService = r
  .resource("app.services.user")
  .meta({
    title: "User Management Service",
    description:
      "Handles user creation, authentication, and profile management",
  })
  .dependencies({ database })
  .init(async (_config, { database }) => ({
    createUser: async (userData) => {
      /* ... */
    },
    authenticateUser: async (credentials) => {
      /* ... */
    },
  }))
  .build();

const sendWelcomeEmail = r
  .task("app.tasks.sendWelcomeEmail")
  .meta({
    title: "Send Welcome Email",
    description: "Sends a welcome email to newly registered users",
  })
  .dependencies({ emailService })
  .run(async (userData, { emailService }) => {
    // Email sending logic
  })
  .build();
```

### Extending Metadata: Custom Properties

For advanced use cases, you can extend the metadata interfaces to add your own properties:

```typescript
// In your types file
declare module "@bluelibs/runner" {
  interface ITaskMeta {
    author?: string;
    version?: string;
    deprecated?: boolean;
    apiVersion?: "v1" | "v2" | "v3";
    costLevel?: "low" | "medium" | "high";
  }

  interface IResourceMeta {
    healthCheck?: string; // URL for health checking
    dependencies?: string[]; // External service dependencies
    scalingPolicy?: "auto" | "manual";
  }
}

// Now use your custom properties
const expensiveApiTask = r
  .task("app.tasks.ai.generateImage")
  .meta({
    title: "AI Image Generation",
    description: "Uses OpenAI DALL-E to generate images from text prompts",
    author: "AI Team",
    version: "2.1.0",
    apiVersion: "v2",
    costLevel: "high", // Custom property!
  })
  .run(async (prompt) => {
    // AI generation logic
  })
  .build();

const database = r
  .resource("app.database.primary")
  .meta({
    title: "Primary PostgreSQL Database",
    healthCheck: "/health/db", // Custom property!
    dependencies: ["postgresql", "connection-pool"],
    scalingPolicy: "auto",
  })
  // .init(async () => { /* ... */ })
  .build();
```

Metadata transforms your components from anonymous functions into self-documenting, discoverable, and controllable building blocks. Use it wisely, and your future self (and your team) will thank you.

> **runtime:** "Ah, metadata—comments with delusions of grandeur. `title`, `description`, `tags`: perfect for machines to admire while I chase the only field that matters: `run`. Wake me when the tags start writing tests."

## Overrides

Sometimes you need to replace a component entirely. Maybe you're doing integration testing or you want to override a library from an external package.

You can now use a dedicated helper `override()` or the fluent builder `r.override(...)` to safely override any property on tasks, resources, or middleware — except `id`. This ensures the identity is preserved, while allowing behavior changes.

```typescript
const productionEmailer = r
  .resource("app.emailer")
  .init(async () => new SMTPEmailer())
  .build();

// Option 1: Fluent override builder (Recommended)
const testEmailer = r
  .override(productionEmailer)
  .init(async () => new MockEmailer())
  .build();

// Option 2: Using override() helper to change behavior while preserving id
const testEmailer = override(productionEmailer, {
  init: async () => new MockEmailer(),
});

// Option 3: The system is really flexible, and override is just bringing in type safety, nothing else under the hood.
// Using spread operator works the same way but does not provide type-safety.
const testEmailer = r
  .resource("app.emailer")
  .init(async () => ({}))
  .build();

const app = r
  .resource("app")
  .register([productionEmailer])
  .overrides([testEmailer]) // This replaces the production version
  .build();

import { override } from "@bluelibs/runner";

// Tasks
const originalTask = r
  .task("app.tasks.compute")
  .run(async () => 1)
  .build();
const overriddenTask = override(originalTask, {
  run: async () => 2,
});

// Resources
const originalResource = r
  .resource("app.db")
  .init(async () => "conn")
  .build();
const overriddenResource = override(originalResource, {
  init: async () => "mock-conn",
});

// Middleware
const originalMiddleware = taskMiddleware({
  id: "app.middleware.log",
  run: async ({ next }) => next(),
});
const overriddenMiddleware = override(originalMiddleware, {
  run: async ({ task, next }) => {
    const result = await next(task?.input);
    return { wrapped: result };
  },
});

// Even hooks
```

The override builder starts from the base definition and applies fluent mutations (dependencies/tags/middleware append by default; use `{ override: true }` to replace). Hook overrides keep the same `.on` target.

Overrides can also extend behavior while reusing the base implementation:

```ts
const extendingEmailer = override(productionEmailer, {
  init: async (config, deps) => {
    const base = await productionEmailer.init(config, deps);
    return {
      ...base,
      async send(to: string, body: string) {
        // Add behavior, then delegate to base
        console.log("Audit email send", { to });
        return base.send(to, body);
      },
    };
  },
});
```

Overrides are applied after everything is registered. If multiple overrides target the same id, the one defined higher in the resource tree (closer to the top) wins, because it's applied last. Conflicting overrides are allowed; overriding something that wasn't registered throws. Use override() to change behavior safely while preserving the original id.

> **runtime:** "Overrides: brain transplant surgery at runtime. You register a penguin and replace it with a velociraptor five lines later. Tests pass. Production screams. I simply update the name tag and pray."

## Namespacing

As your app grows, you'll want consistent naming. Here's the convention that won't drive you crazy:

| Type                | Format                                           |
| ------------------- | ------------------------------------------------ |
| Resources           | `{domain}.{noun}`                                |
| Tasks               | `{domain}.tasks.{verb}`                          |
| Events              | `{domain}.events.{pastTenseVerbOrNoun}`          |
| Hooks               | `{domain}.hooks.{name}` (use `onX` for handlers) |
| Task Middleware     | `{domain}.middleware.task.{name}`                |
| Resource Middleware | `{domain}.middleware.resource.{name}`            |
| Errors              | `{domain}.errors.{PascalCaseName}`               |
| Async Context       | `{domain}.ctx.{noun}`                            |
| Tags                | `{domain}.tags.{noun}`                           |

Use dot-separated IDs and keep them human-readable. Prefer `camelCase` for the final segment (tasks/events/hooks/middleware/ctx/tags) and `PascalCase` for errors.
Use verbs for task IDs, past tense for event IDs, and nouns for resources/contexts/tags.
Kebab-case is still great for file names (for example: `create-user.task.ts`, `auth.task-middleware.ts`, `on-user-created.hook.ts`).

Folders can look like this: `src/app/users/tasks/create-user.task.ts`. Keep the example domain consistent (for example `app.*`) unless you're intentionally showing cross-domain composition.

```typescript
// Helper function for consistency
function namespaced(id: string) {
  return `app.${id}`;
}

const createUserTask = r
  .task(namespaced("tasks.createUser"))
  .run(async () => null)
  .build();
```

> **runtime:** "Naming conventions: aromatherapy for chaos. Lovely lavender labels on a single giant map I maintain anyway. But truly—keep the IDs tidy. Future‑you deserves at least this mercy."

## Factory Pattern

To keep things dead simple, we avoided polluting the D.I. with this concept. Therefore, we recommend using a resource with a factory function to create instances of your classes:

```typescript
// Assume MyClass is defined elsewhere
// class MyClass { constructor(input: any, option: string) { ... } }

const myFactory = r
  .resource("app.factories.myFactory")
  .init(async (config: { someOption: string }) => {
    // This resource's value is a factory function
    return (input: any) => new MyClass(input, config.someOption);
  })
  .build();

const app = r
  .resource("app")
  // Configure the factory resource upon registration
  .register([myFactory.with({ someOption: "configured-value" })])
  .dependencies({ myFactory })
  .init(async (_config, { myFactory }) => {
    // `myFactory` is now the configured factory function
    const instance = myFactory({ someInput: "hello" });
  })
  .build();
```

> **runtime:** "Factory by resource by function by class. A nesting doll of indirection so artisanal it has a Patreon. Not pollution—boutique smog. I will still call the constructor."

## Runtime Validation

Here's the issue: TypeScript types only exist at compile time. When your API receives JSON from an HTTP request, or when data comes from a database, TypeScript can't help you validate it. Invalid data crashes your app or causes subtle bugs.

**The problem**: You need to validate data at runtime (where TypeScript can't help), but you don't want to write validation logic twice.

**The naive solution**: Use a separate validation library but manually map types. But this duplicates work and types can get out of sync.

**The better solution**: Use runtime validation with libraries like Zod that infer types from validation schemas.

### When to use Runtime Validation

| Use case | Why Runtime Validation helps |
|----------|-------------------------------|
| API input | Validate HTTP request bodies |
| Database data | Validate data loaded from DB |
| External services | Validate responses from APIs |
| User input | Validate form submissions |

BlueLibs Runner includes a generic validation interface that works with any validation library, including [Zod](https://zod.dev/), [Yup](https://github.com/jquense/yup), [Joi](https://joi.dev/), and others.

The framework defines a simple `IValidationSchema<T>` interface that any validation library can implement:

```typescript
interface IValidationSchema<T> {
  parse(input: unknown): T;
}
```

Popular validation libraries already implement this interface:

- **Zod**: `.parse()` method works directly
- **Yup**: Use `.validateSync()` or create a wrapper
- **Joi**: Use `.assert()` or create a wrapper
- **Custom validators**: Implement the interface yourself

### Task Input Validation

Add an `inputSchema` to any task to validate inputs before execution:

```typescript
import { z } from "zod";
import { task, resource, run } from "@bluelibs/runner";

const userSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  age: z.number().min(0).max(150),
});

const createUserTask = r
  .task("app.tasks.createUser")
  .inputSchema(userSchema) // Works directly with Zod!
  .run(async (userData) => {
    // userData is validated and properly typed
    return { id: "user-123", ...userData };
  })
  .build();

const app = r
  .resource("app")
  .register([createUserTask])
  .dependencies({ createUserTask })
  .init(async (_config, { createUserTask }) => {
    // This works - valid input
    const user = await createUserTask({
      name: "John Doe",
      email: "john@example.com",
      age: 30,
    });

    // This throws a validation error at runtime
    try {
      await createUserTask({
        name: "J", // Too short
        email: "invalid-email", // Invalid format
        age: -5, // Negative age
      });
    } catch (error) {
      console.log(error.message);
      // "Task input validation failed for app.tasks.createUser: ..."
    }
  })
  .build();
```

### Resource Config Validation

Add a `configSchema` to resources to validate configurations. **Validation happens immediately when `.with()` is called**, ensuring configuration errors are caught early:

```typescript
const databaseConfigSchema = z.object({
  host: z.string(),
  port: z.number().min(1).max(65535),
  database: z.string(),
  ssl: z.boolean().default(false), // Optional with default
});

const databaseResource = r
  .resource("app.resources.database")
  .configSchema(databaseConfigSchema) // Validation on .with()
  .init(async (config) => {
    // config is already validated and has proper types
    return createConnection({
      host: config.host,
      port: config.port,
      database: config.database,
      ssl: config.ssl,
    });
  })
  .build();

// Validation happens here, not during init!
try {
  const configuredResource = databaseResource.with({
    host: "localhost",
    port: 99999, // Invalid: port too high
    database: "myapp",
  });
} catch (error) {
  // "Resource config validation failed for app.resources.database: ..."
}

const app = r
  .resource("app")
  .register([
    databaseResource.with({
      host: "localhost",
      port: 5432,
      database: "myapp",
      // ssl defaults to false
    }),
  ])
  .build();
```

### Event Payload Validation

Add a `payloadSchema` to events to validate payloads every time they're emitted:

```typescript
const userActionSchema = z.object({
  userId: z.string().uuid(),
  action: z.enum(["created", "updated", "deleted"]),
  timestamp: z.date().default(() => new Date()),
});

const userActionEvent = r
  .event("app.events.userAction")
  .payloadSchema(userActionSchema) // Validates on emit
  .build();

const notificationHook = r
  .hook("app.tasks.sendNotification")
  .on(userActionEvent)
  .run(async (eventData) => {
    // eventData.data is validated and properly typed
    console.log(`User ${eventData.data.userId} was ${eventData.data.action}`);
  })
  .build();

const app = r
  .resource("app")
  .register([userActionEvent, notificationHook])
  .dependencies({ userActionEvent })
  .init(async (_config, { userActionEvent }) => {
    // This works - valid payload
    await userActionEvent({
      userId: "123e4567-e89b-12d3-a456-426614174000",
      action: "created",
    });

    // This throws validation error when emitted
    try {
      await userActionEvent({
        userId: "invalid-uuid",
        action: "unknown",
      });
    } catch (error) {
      // "Event payload validation failed for app.events.userAction: ..."
    }
  })
  .build();
```

### Middleware Config Validation

Add a `configSchema` to middleware to validate configurations. Like resources, **validation happens immediately when `.with()` is called**:

```typescript
const timingConfigSchema = z.object({
  timeout: z.number().positive(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  logSuccessful: z.boolean().default(true),
});

const timingMiddleware = r.middleware
  .task("app.middleware.timing") // or r.middleware.resource("...")
  .configSchema(timingConfigSchema) // Validation on .with()
  .run(async ({ next }, _, config) => {
    const start = Date.now();
    try {
      const result = await next();
      const duration = Date.now() - start;
      if (config.logSuccessful && config.logLevel === "debug") {
        console.log(`Operation completed in ${duration}ms`);
      }
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      console.log(`Operation failed after ${duration}ms`);
      throw error;
    }
  })
  .build();

// Validation happens here, not during execution!
try {
  const configuredMiddleware = timingMiddleware.with({
    timeout: -5, // Invalid: negative timeout
    logLevel: "invalid", // Invalid: not in enum
  });
} catch (error) {
  // "Middleware config validation failed for app.middleware.timing: ..."
}

const myTask = r
  .task("app.tasks.example")
  .middleware([
    timingMiddleware.with({
      timeout: 5000,
      logLevel: "debug",
      logSuccessful: true,
    }),
  ])
  .run(async () => "success")
  .build();
```

#### Advanced Validation Features

Any validation library features work with the generic interface. Here's an example with transformations and refinements:

```typescript
const advancedSchema = z
  .object({
    userId: z.string().uuid(),
    amount: z.string().transform((val) => parseFloat(val)), // Transform string to number
    currency: z.enum(["USD", "EUR", "GBP"]),
    metadata: z.record(z.string()).optional(),
  })
  .refine((data) => data.amount > 0, {
    message: "Amount must be positive",
    path: ["amount"],
  });

const paymentTask = r
  .task("app.tasks.payment")
  .inputSchema(advancedSchema)
  .run(async (payment) => {
    // payment.amount is now a number (transformed from string)
    // All validations have passed
    return processPayment(payment);
  })
  .build();
```

### Error Handling

Validation errors are thrown with clear, descriptive messages that include the component ID:

```typescript
// Task validation error format:
// "Task input validation failed for {taskId}: {validationErrorMessage}"

// Resource validation error format (thrown on .with() call):
// "Resource config validation failed for {resourceId}: {validationErrorMessage}"

// Event validation error format (thrown on emit):
// "Event payload validation failed for {eventId}: {validationErrorMessage}"

// Middleware validation error format (thrown on .with() call):
// "Middleware config validation failed for {middlewareId}: {validationErrorMessage}"
```

#### Other Libraries

The framework works with any validation library that implements the `IValidationSchema<T>` interface:

```typescript
// Zod (works directly)
import { z } from "zod";
const zodSchema = z.string().email();

// Yup (with wrapper)
import * as yup from "yup";
const yupSchema = {
  parse: (input: unknown) => yup.string().email().validateSync(input),
};

// Joi (with wrapper)
import Joi from "joi";
const joiSchema = {
  parse: (input: unknown) => {
    const { error, value } = Joi.string().email().validate(input);
    if (error) throw error;
    return value;
  },
};

// Custom validation
const customSchema = {
  parse: (input: unknown) => {
    if (typeof input !== "string" || !input.includes("@")) {
      throw new Error("Must be a valid email");
    }
    return input;
  },
};
```

#### When to Use Validation

- **API boundaries**: Validating user inputs from HTTP requests
- **External data**: Processing data from files, databases, or APIs
- **Configuration**: Ensuring environment variables and configs are correct (fail fast)
- **Event payloads**: Validating data in event-driven architectures
- **Middleware configs**: Validating middleware settings at registration time (fail fast)

#### Performance Notes

- Validation only runs when schemas are provided (zero overhead when not used)
- Resource and middleware validation happens once at registration time (`.with()`)
- Task and event validation happens at runtime
- Consider the validation library's performance characteristics for your use case
- All major validation libraries are optimized for runtime validation

#### TypeScript Integration

While runtime validation happens with your chosen library, TypeScript still enforces compile-time types. For the best experience:

```typescript
// With Zod, define your type and schema together

const userSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});

type UserData = z.infer<typeof userSchema>;

const createUser = r
  .task("app.tasks.createUser.zod")
  .inputSchema(userSchema)
  .run(async (input: UserData) => {
    // Both runtime validation AND compile-time typing
    return { id: "user-123", ...input };
  })
  .build();
```

> **runtime:** "Validation: you hand me a velvet rope and a clipboard. 'Name? Email? Age within bounds?' I stamp passports or eject violators with a `ValidationError`. Dress code is types, darling."

## Type Contracts

Consider this: You have an authentication tag, and you want to ensure ALL tasks using it actually accept a `userId` in their input. TypeScript doesn't know about your tags—it can't enforce that every task using auth has the right input shape. How do you make this compile-time enforced?

**The problem**: You want to enforce that tasks using certain tags or middleware conform to specific input/output shapes, but plain TypeScript types can't express "any task with tag X must have property Y."

**The naive solution**: Document the requirements and add runtime checks. But this is error-prone and bugs aren't caught until runtime.

**The better solution**: Use Type Contracts, which allow Tags and Middleware to declare input/output contracts that are enforced at compile time.

### When to use Type Contracts

| Use case | Why Type Contracts help |
|----------|------------------------|
| Authentication | Ensure all auth tasks include userId |
| API standardization | Enforce consistent response shapes |
| Validation | Guarantee tasks return required fields |
| Documentation | Make requirements self-enforcing |

### Concept

A **Tag** or **Middleware** can declare:

- **Input Contract**: "Any task using me MUST accept at least specific properties in its input"
- **Output Contract**: "Any task using me MUST return at least specific properties"

The enforcement happens at **compile time**. If you try to use the `authorizedTag` on a task that doesn't accept a `userId`, TypeScript will yell at you.

### Example: Enforcing Authentication Identity

Let's say we want to ensure that any task using the `authorizedTag` receives a `userId`:

```typescript
import { r } from "@bluelibs/runner";

// 1. Define the Tag with an INPUT contract
// <Config, InputContract, OutputContract>
const authorizedTag = r
  .tag<void, { userId: string }, void>("app.tags.authorized")
  .build();

// 2. This works: Task accepts userId
const validTask = r
  .task("app.tasks.dashboard")
  .tags([authorizedTag])
  .run(async (input: { userId: string; view: "full" | "mini" }) => {
    // We are guaranteed that input has userId
    return { data: "..." };
  })
  .build();

// 3. This fails compilation: Task input is missing userId
const invalidTask = r
  .task("app.tasks.public")
  .tags([authorizedTag])
  // @ts-expect-error - input doesn't satisfy contract { userId: string }
  .run(async (input: { view: "full" }) => {
    return { data: "..." };
  })
  .build();
```

### Example: Enforcing Response Shape

You can also enforce that tasks return specific data. For example, a "Searchable" tag might require tasks to return an `id` and `title`:

```typescript
// Enforce that output has { id: string; title: string }
const searchableTag = r
  .tag<void, void, { id: string; title: string }>("app.tags.searchable")
  .build();

const productTask = r
  .task("app.products.get")
  .tags([searchableTag])
  .run(async (id: string) => {
    return {
      id,
      title: "Super Gadget",
      price: 99.99, // Extra fields are fine
    };
  })
  .build();
```

> **runtime:** "Type Contracts: The prenup of code. 'If you want to use my authorizedTag, you _will_ bring a userId to the table.' It's not controlling; it's just... strictly typed love."

### Resource Contracts

For **Resources**, the contracts map slightly differently:

- **Input Contract** → Enforced on the **Resource Configuration** (passed to `.with()` and `init`)
- **Output Contract** → Enforced on the **Resource Value** (returned from `init`)

This is powerful for enforcing architectural standards. For example, you can create a "Database" tag that requires any database resource to return a specific connection interface.

```typescript
// Define a tag that expects:
// - Config: { connectionString: string }
// - Value: { connect(): Promise<void> }
const databaseTag = r
  .tag<
    void,
    { connectionString: string },
    { connect(): Promise<void> }
  >("app.tags.database")
  .build();

// Valid resource
const validDb = r
  .resource("app.db")
  .tags([databaseTag])
  // Enforced: config must have connectionString
  .init(async (config) => {
    return {
      // Enforced: must return object with connect()
      async connect() {
        /* ... */
      },
    };
  })
  .build();

// Invalid resource (TypeScript error)
const invalidDb = r
  .resource("app.bad-db")
  .tags([databaseTag])
  // Error: Property 'connectionString' is missing in type '{}'
  .init(async (config: {}) => {
    return { foo: "bar" }; // Error: Property 'connect' is missing
  })
  .build();
```

## Internal Services

We expose the internal services for advanced use cases (but try not to use them unless you really need to):

When you call `run(app)`, Runner creates an isolated runtime container for that specific run. During bootstrap, it registers built-in global resources for that container, including `globals.resources.runtime`.

`globals.resources.runtime` resolves to the same runtime object returned by `run(app)`, scoped to that container only. This lets code running *inside* the container inject `runtime` and perform runtime operations (`runTask`, `emitEvent`, `getResourceValue`, root helpers, etc.) without passing the outer runtime object around manually.

Bootstrap timing note: inside resource `init()`, `runtime` is available early, but that does **not** mean every registered resource is initialized yet. Runner guarantees dependency readiness for the currently initializing resource; unrelated resources may still be pending (especially with `initMode: "parallel"` or `lazy: true`).

```typescript
import { globals } from "@bluelibs/runner";

const advancedTask = r
  .task("app.advanced")
  .dependencies({
    // Available because run(app) injects this resource into the current container.
    runtime: globals.resources.runtime,
    store: globals.resources.store,
    taskRunner: globals.resources.taskRunner,
    eventManager: globals.resources.eventManager,
  })
  .run(async (_param, { runtime, store, taskRunner, eventManager }) => {
    // Direct access to the framework internals
    // runtime gives a safe facade inside resources:
    // runTask, emitEvent, getResourceValue/getResourceConfig, and root helpers.
    // (Use with caution!)
  })
  .build();
```

### Dynamic Dependencies

Dependencies can be defined in two ways - as a static object or as a function that returns an object. Each approach has its use cases:

```typescript
// Static dependencies (most common)
const userService = r
  .resource("app.services.user")
  .dependencies({ database, logger }) // Object - evaluated immediately
  .init(async (_config, { database, logger }) => {
    // Dependencies are available here
  })
  .build();

// Dynamic dependencies (for circular references or conditional dependencies)
const advancedService = r
  .resource("app.services.advanced")
  // A function gives you the chance
  .dependencies((_config) => ({
    // Config is what you receive when you register this resource with .with()
    // So you can have conditional dependencies based on resource configuration as well.
    database,
    logger,
    conditionalService:
      process.env.NODE_ENV === "production" ? serviceA : serviceB,
  })) // Function - evaluated when needed
  .register((_config: ConfigType) => [
    // Register dependencies dynamically
    process.env.NODE_ENV === "production"
      ? serviceA.with({ config: "value" })
      : serviceB.with({ config: "value" }),
  ])
  .init(async (_config, { database, logger, conditionalService }) => {
    // Same interface, different evaluation timing
  })
  .build();
```

The function pattern essentially gives you "just-in-time" dependency resolution instead of "eager" dependency resolution, which provides more flexibility and better handles complex dependency scenarios that arise in real-world applications.

**Performance note**: Function-based dependencies have minimal overhead - they're only called once during dependency resolution.

> **runtime:** "'Use with caution,' they whisper, tossing you the app credentials to the universe. Yes, reach into the `store`. Rewire fate. When the graph looks like spaghetti art, I'll frame it and label it 'experimental.'"

## Handling Circular Dependencies

Sometimes you'll run into circular type dependencies because of your file structure not necessarily because of a real circular dependency. TypeScript struggles with these, but there's a way to handle it gracefully.

### The Problem

Consider these resources that create a circular dependency:

```typescript
// FILE: a.ts
export const aResource = defineResource({
  dependencies: { b: bResource },
  // ... depends on B resource.
});
// For whatever reason, you decide to put the task in the same file.
export const aTask = defineTask({
  dependencies: { a: aResource },
});

// FILE: b.ts
export const bResource = defineResource({
  id: "b.resource",
  dependencies: { c: cResource },
});

// FILE: c.ts
export const cResource = defineResource({
  id: "c.resource",
  dependencies: { aTask }, // Creates circular **type** dependency! Cannot infer types properly, even if the runner boots because there's no circular dependency.
  async init(_, { aTask }) {
    return `C depends on aTask`;
  },
});
```

A depends B depends C depends ATask. No circular dependency, yet Typescript struggles with these, but there's a way to handle it gracefully.

### The Solution

The fix is to explicitly type the resource that completes the circle using a simple assertion `IResource<Config, ReturnType>`. This breaks the TypeScript inference chain while maintaining runtime functionality:

```typescript
// c.resource.ts - The key change
import { IResource } from "../../defs";

export const cResource = defineResource({
  id: "c.resource",
  dependencies: { a: aResource },
  async init(_, { a }) {
    return `C depends on ${a}`;
  },
}) as IResource<void, Promise<string>>; // void because it has no config, string because it returns a string
```

#### Why This Works

- **Runtime**: The circular dependency still works at runtime because the framework resolves dependencies dynamically
- **TypeScript**: The explicit type annotation prevents TypeScript from trying to infer the return type based on the circular chain
- **Type Safety**: You still get full type safety by explicitly declaring the return type (`string` in this example)

#### Best Practices

1. **Identify the "leaf" resource**: Choose the resource that logically should break the chain (often the one that doesn't need complex type inference)
2. **Use explicit typing**: Add the `IResource<Dependencies, ReturnType>` type annotation
3. **Document the decision**: Add a comment explaining why the explicit typing is needed
4. **Consider refactoring**: If you have many circular dependencies, consider if your architecture could be simplified

#### Example with Dependencies

If your resource has dependencies, include them in the type:

```typescript
type MyDependencies = {
  someService: SomeServiceType;
  anotherResource: AnotherResourceType;
};

export const problematicResource = defineResource({
  id: "problematic.resource",
  dependencies: {
    /* ... */
  },
  async init(config, deps) {
    // Your logic here
    return someComplexObject;
  },
}) as IResource<MyDependencies, ComplexReturnType>;
```

This pattern allows you to maintain clean, type-safe code while handling the inevitable circular dependencies that arise in complex applications.

> **runtime:** "Circular dependencies: Escher stairs for types. You serenade the compiler with 'as IResource' and I do the parkour at runtime. It works. It's weird. Nobody tell the linter."
