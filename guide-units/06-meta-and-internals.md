## Meta and Internals

This section covers internal services, execution boundaries, and extending components with metadata. These patterns are mostly needed when building advanced orchestration or developer tools on top of Runner.

---

## Meta

Think about generating API documentation automatically from your tasks, or building an admin dashboard that shows what each task does without reading code. Or you need to categorize tasks by feature for billing purposes. How do you attach descriptive information to components?

**The problem**: You need to document what components do and categorize them, but there's no standard place to store this metadata.

**The naive solution**: Use naming conventions or external documentation. But this gets out of sync easily and doesn't integrate with tooling.

**The better solution**: Use Meta, a structured way to describe what your components do.

### When to Use Meta

| Use case         | Why Meta helps                                 |
| ---------------- | ---------------------------------------------- |
| API docs         | Generate documentation from component metadata |
| Admin dashboards | Display component descriptions                 |
| Billing          | Categorize tasks by feature for metering       |
| Discovery        | Search components by title/description         |

### Metadata Properties

Every component can have these basic metadata properties:

```typescript
interface IMeta {
  title?: string; // Human-readable name
  description?: string; // What this component does
}
```

Use `.tags([...])` for behavioral categorization/filtering. Keep `.meta(...)` focused on descriptive documentation fields.

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

## Namespacing

Runner supports **scoped local names** during registration, then compiles everything to canonical runtime IDs.

You can define local names inside a resource subtree:

```typescript
const createUser = r
  .task("createUser")
  .run(async () => null)
  .build();

const userRegistered = r.event("userRegistered").build();
const db = r
  .resource("db")
  .init(async () => ({}))
  .build();

const app = r
  .resource("app")
  .register([createUser, userRegistered, db])
  .build();
```

At runtime/store level, IDs become canonical:

| Kind                | Local name -> Canonical ID                         |
| ------------------- | -------------------------------------------------- |
| Resource            | `db` -> `app.db`                                   |
| Task                | `createUser` -> `app.tasks.createUser`             |
| Event               | `userRegistered` -> `app.events.userRegistered`    |
| Hook                | `onUserRegistered` -> `app.hooks.onUserRegistered` |
| Task Middleware     | `auth` -> `app.middleware.task.auth`               |
| Resource Middleware | `audit` -> `app.middleware.resource.audit`         |
| Tag                 | `public` -> `app.tags.public`                      |
| Error               | `invalidInput` -> `app.errors.invalidInput`        |
| Async Context       | `request` -> `app.asyncContexts.request`           |

Important behavior:

- Inside `run(...)`, middleware, hooks, lane policies, and validators, `definition.id` is always the canonical runtime ID.
- Original definition objects are not mutated; per-run compiled definitions are stored internally (run isolation safe).
- Canonical ids are composed structurally from owner resources; prefer local definition ids and reference-based wiring.
- Only the internal synthetic framework root is transparent; user resources always contribute their own ownership segment to canonical ids.
- Local names fail fast if they use reserved segments: `tasks`, `resources`, `events`, `hooks`, `tags`, `errors`, `asyncContexts`.
- All definition ids fail fast when they start/end with `.`, contain empty segments (`..`), or equal a reserved standalone local name.

> **runtime:** "You give me short names in your little subtree village. I issue passports with full addresses at the border. Everybody wins, and nobody argues about dots all day."

## Internal Services

Runner registers a set of built-in system resources during bootstrap. These are the engine parts exposed as injectable dependencies for advanced scenarios. Prefer higher-level APIs where they exist; reach for these only when you need direct control.

| Resource                      | What it gives you                                                                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resources.mode`              | The resolved runtime mode as a narrow read-only value (`"dev" \| "prod" \| "test"`). Prefer this over `resources.runtime` when you only need mode-aware branching.                                                               |
| `resources.runtime`           | The same handle returned by `run(app)`, scoped to this app. Use inside resources to call `runTask`, `emitEvent`, `getResourceValue`, or inspect `runtime.root` without passing the outer handle manually.                         |
| `resources.taskRunner`        | The `TaskRunner` that executes tasks. Install global interceptors here during `init()` — before the runtime locks.                                                                                                                |
| `resources.eventManager`      | The `EventManager` powering event emission and hook dispatch. Register global event or hook interceptors here.                                                                                                                    |
| `resources.middlewareManager` | The `MiddlewareManager` that composes task and resource middleware chains. Use `intercept("task" \| "resource", ...)` or `interceptMiddleware(mw, ...)` to wrap execution globally.                                               |
| `resources.store`             | The flat definition registry built from the compiled graph. Query any definition by canonical id, iterate definitions by kind, or inspect the full registered surface.                                                            |
| `resources.logger`            | The built-in structured logger. Supports `debug`, `info`, `warn`, and `error` log levels.                                                                                                                                         |
| `resources.health`            | The health reporter. Call `health.getHealth([...])` to poll resource health probes from inside the graph.                                                                                                                         |
| `resources.cache`             | The default LRU cache backing `middleware.task.cache`. Replace it with a Redis-backed provider via `resources.cache.with(...)` to share state across instances.                                                                   |
| `resources.timers`            | Lifecycle-aware timer management. `timers.setTimeout` and `timers.setInterval` stop accepting new work once `cooldown()` starts and are cleared during `dispose()`. Prefer these over raw `setTimeout` inside resources or tasks. |

Bootstrap timing: inside resource `init()`, `resources.runtime` is available early, but that does **not** mean every registered resource is initialized. Runner guarantees that declared dependencies are ready; unrelated resources may still be pending — especially with `lifecycleMode: "parallel"` or `lazy: true`.

```typescript
import { r, resources } from "@bluelibs/runner";

// Example: install a global task interceptor and query the store.
const telemetry = r
  .resource("app.telemetry")
  .dependencies({
    taskRunner: resources.taskRunner,
    store: resources.store,
    logger: resources.logger,
  })
  .init(async (_config, { taskRunner, store, logger }) => {
    // Intercept all tasks globally during init, before the runtime locks.
    taskRunner.intercept(async (next, input) => {
      const start = Date.now();
      try {
        return await next(input);
      } finally {
        await logger.info(
          `${input.task.definition.id} took ${Date.now() - start}ms`,
        );
      }
    });

    // Inspect the registered surface via the store.
    const allTasks = store.getDefinitionsByKind("task");
    await logger.debug(
      `Registered tasks: ${allTasks.map((t) => t.id).join(", ")}`,
    );
  })
  .build();
```

> **runtime:** "'Use with caution,' they whisper, tossing you the app credentials to the universe. Yes, reach into the `store`. Rewire fate. When the graph looks like spaghetti art, I'll frame it and label it 'experimental.'"
