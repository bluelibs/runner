## Meta

_The structured way to describe what your components do and control their behavior_

Metadata in BlueLibs Runner provides a systematic way to document, categorize, and control the behavior of your tasks, resources, events, and middleware. Think of it as your component's passport - it tells you and your tools everything they need to know about what this component does and how it should be treated.

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

Overrides can let you expand dependencies and even call your overriden resource (like a classical OOP extends):

```ts
const testEmailer = override(productionEmailer, {
  dependencies: {
    ...productionEmailer,
    // expand it, make some deps optional, or just remove some dependencies
  }
  init: async (_, deps) => {
    const base = productionEmailer.init(_, deps);

    return {
      ...base,
      // expand it, modify methods of base.
    }
  },
});
```

Overrides are applied after everything is registered. If multiple overrides target the same id, the one defined higher in the resource tree (closer to the root) wins, because it's applied last. Conflicting overrides are allowed; overriding something that wasn't registered throws. Use override() to change behavior safely while preserving the original id.

> **runtime:** "Overrides: brain transplant surgery at runtime. You register a penguin and replace it with a velociraptor five lines later. Tests pass. Production screams. I simply update the name tag and pray."

## Namespacing

As your app grows, you'll want consistent naming. Here's the convention that won't drive you crazy:

| Type                | Format                                           |
| ------------------- | ------------------------------------------------ |
| Resources           | `{domain}.resources.{resource-name}`             |
| Tasks               | `{domain}.tasks.{task-name}`                     |
| Events              | `{domain}.events.{event-name}`                   |
| Hooks               | `{domain}.hooks.on-{event-name}`                 |
| Task Middleware     | `{domain}.middleware.task.{middleware-name}`     |
| Resource Middleware | `{domain}.middleware.resource.{middleware-name}` |

We recommend kebab-case for file names and ids. Suffix files with their primitive type: `*.task.ts`, `*.task-middleware.ts`, `*.hook.ts`, etc.

Folders can look something like this: `src/app/users/tasks/create-user.task.ts`. For domain: `app.users` and a task. Use `middleware/task|resource` for middleware files.

```typescript
// Helper function for consistency
function namespaced(id: string) {
  return `mycompany.myapp.${id}`;
}

const userTask = r
  .task(namespaced("tasks.user.create-user"))
  .run(async () => null)
  .build();
```

> **runtime:** "Naming conventions: aromatherapy for chaos. Lovely lavender labels on a single giant map I maintain anyway. But truly—keep the IDs tidy. Future‑you deserves at least this mercy."

## Factory Pattern

To keep things dead simple, we avoided poluting the D.I. with this concept. Therefore, we recommend using a resource with a factory function to create instances of your classes:

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

BlueLibs Runner includes a generic validation interface that works with any validation library, including [Zod](https://zod.dev/), [Yup](https://github.com/jquense/yup), [Joi](https://joi.dev/), and others. The framework provides runtime validation with excellent TypeScript inference while remaining library-agnostic.

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
