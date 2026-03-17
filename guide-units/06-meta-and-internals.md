## Meta and Internals

This chapter covers two advanced surfaces:

- `meta(...)` for descriptive, tool-friendly component metadata
- built-in runtime services such as `resources.taskRunner` and `resources.store`

Most apps do not need these on day one. They become valuable when you build tooling, policy layers, discovery flows, or framework-style infrastructure on top of Runner.

## Meta

Use `meta(...)` when you need human-friendly descriptions that stay attached to the definition itself.

### When to Use Meta

| Use case         | Why Meta helps                                 |
| ---------------- | ---------------------------------------------- |
| API docs         | Generate docs from the actual Runner graph     |
| Admin dashboards | Display component descriptions                 |
| Billing          | Categorize features for metering               |
| Discovery        | Search components by title or description      |

### Metadata Properties

Every definition can use the base metadata shape:

```typescript
interface IMeta {
  title?: string;
  description?: string;
}
```

Use `.tags([...])` for behavioral grouping or policy. Keep `.meta(...)` focused on descriptive fields that help humans and tooling understand what a component is for.

### Simple Documentation Example

This example assumes `database` and `emailService` are dependencies defined elsewhere in your app.

```typescript
import { r } from "@bluelibs/runner";

const userService = r
  .resource("userService")
  .meta({
    title: "User Management Service",
    description:
      "Handles user creation, authentication, and profile management",
  })
  .dependencies({ database })
  .init(async (_config, { database }) => ({
    createUser: async (userData: { email: string }) => {
      return database.insert(userData);
    },
  }))
  .build();

const sendWelcomeEmail = r
  .task("sendWelcomeEmail")
  .meta({
    title: "Send Welcome Email",
    description: "Sends a welcome email to a newly registered user",
  })
  .dependencies({ emailService })
  .run(async (userData: { email: string }, { emailService }) => {
    await emailService.sendWelcome(userData.email);
  })
  .build();
```

### Extending Metadata

You can extend Runner's metadata interfaces with your own properties:

```typescript
declare module "@bluelibs/runner" {
  interface ITaskMeta {
    author?: string;
    version?: string;
    apiVersion?: "v1" | "v2" | "v3";
    costLevel?: "low" | "medium" | "high";
  }

  interface IResourceMeta {
    healthCheck?: string;
    dependencies?: string[];
    scalingPolicy?: "auto" | "manual";
  }
}

import { r } from "@bluelibs/runner";

const generateImage = r
  .task("generateImage")
  .meta({
    title: "AI Image Generation",
    description: "Generates images from prompts",
    author: "AI Team",
    version: "2.1.0",
    apiVersion: "v2",
    costLevel: "high",
  })
  .run(async (_prompt: string) => null)
  .build();

const database = r
  .resource("database")
  .meta({
    title: "Primary PostgreSQL Database",
    healthCheck: "/health/db",
    dependencies: ["postgresql", "connection-pool"],
    scalingPolicy: "auto",
  })
  .build();
```

## Namespacing

Runner definitions use **local ids** at authoring time and **canonical ids** at runtime.

You define local ids:

```typescript
import { r } from "@bluelibs/runner";

const createUser = r.task("createUser").run(async () => null).build();
const userRegistered = r.event("userRegistered").build();
const database = r.resource("database").init(async () => ({})).build();

const app = r
  .resource("app")
  .register([createUser, userRegistered, database])
  .build();
```

Runner composes canonical ids from ownership:

| Kind                | Local id -> Canonical id                         |
| ------------------- | ------------------------------------------------ |
| Resource            | `database` -> `app.database`                     |
| Task                | `createUser` -> `app.tasks.createUser`           |
| Event               | `userRegistered` -> `app.events.userRegistered`  |
| Hook                | `onUserRegistered` -> `app.hooks.onUserRegistered` |
| Task Middleware     | `auth` -> `app.middleware.task.auth`             |
| Resource Middleware | `audit` -> `app.middleware.resource.audit`       |
| Tag                 | `public` -> `app.tags.public`                    |
| Error               | `invalidInput` -> `app.errors.invalidInput`      |
| Async Context       | `requestContext` -> `app.asyncContexts.requestContext` |

Important behavior:

- prefer local ids in builders
- use references such as `runTask(createUser, input)` whenever possible
- canonical ids appear in runtime/store surfaces, logs, and discovery APIs
- only the internal synthetic framework root is transparent; user resources always contribute their own ownership segment
- reserved local ids fail fast: `tasks`, `resources`, `events`, `hooks`, `tags`, `errors`, `asyncContexts`

## Internal Services

Runner registers a set of built-in resources during bootstrap. These are useful when you need direct control over runtime behavior.

These built-ins sit under two synthetic framework namespace resources:

- `system`: owns locked internal infrastructure such as `resources.store`, `resources.eventManager`, `resources.taskRunner`, `resources.middlewareManager`, `resources.runtime`, and lifecycle events
- `runner`: owns built-in utility globals such as `resources.mode`, `resources.health`, `resources.timers`, `resources.logger`, `resources.serializer`, `resources.queue`, core tags, middleware, framework errors, and optional debug/execution-context resources

Both namespace resources are real Runner resources and expose `.meta.title` / `.meta.description` for docs and tooling. They also enforce the same metadata contract across the framework-owned resources, events, hooks, tags, and middleware they register. The transparent `runtime-framework-root` above them remains internal-only and does not appear in user-facing canonical ids.

| Resource                      | What it gives you                                                                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resources.mode`              | The resolved runtime mode as a read-only value (`"dev" \| "prod" \| "test"`). Prefer this when you only need mode-aware branching.                                                                                              |
| `resources.runtime`           | The same handle returned by `run(app)`, scoped to this app. Use it inside resources to call `runTask`, `emitEvent`, or inspect the runtime without passing the outer handle manually.                                            |
| `resources.taskRunner`        | The `TaskRunner` that executes tasks. Install global task interceptors here during `init()`.                                                                                                                                     |
| `resources.eventManager`      | The `EventManager` that powers event emission and hook dispatch. Register global event or hook interceptors here.                                                                                                                 |
| `resources.middlewareManager` | The `MiddlewareManager` that composes task and resource middleware chains. Use `intercept("task" \| "resource", ...)` or `interceptMiddleware(...)` for global wrapping.                                                        |
| `resources.store`             | The flat definition registry built from the compiled graph. Query definitions by canonical id, iterate by kind, or inspect the full registered surface.                                                                          |
| `resources.logger`            | The built-in structured logger. Supports `trace`, `debug`, `info`, `warn`, `error`, and `critical`.                                                                                                                             |
| `resources.health`            | The health reporter. Call `health.getHealth([...])` to poll resource health probes from inside the graph.                                                                                                                         |
| `resources.cache`             | The default LRU cache backing `middleware.task.cache`. Replace it with a custom or Redis-backed provider when you need shared state.                                                                                             |
| `resources.timers`            | Lifecycle-aware timer management. `setTimeout` and `setInterval` stop accepting new work once `cooldown()` starts and are cleared during `dispose()`.                                                                            |

Bootstrap timing matters: inside resource `init()`, `resources.runtime` exists early, but not every unrelated resource is initialized yet. Runner guarantees declared dependencies, not whole-world readiness.

### Example: Install a Global Task Interceptor

```typescript
import { r, resources } from "@bluelibs/runner";

const telemetry = r
  .resource("telemetry")
  .dependencies({
    taskRunner: resources.taskRunner,
    store: resources.store,
    logger: resources.logger,
  })
  .init(async (_config, { taskRunner, store, logger }) => {
    taskRunner.intercept(async (next, input) => {
      const startedAt = Date.now();

      try {
        return await next(input);
      } finally {
        await logger.info("Task completed", {
          data: {
            taskId: input.task.definition.id,
            durationMs: Date.now() - startedAt,
          },
        });
      }
    });

    const allTasks = store.getDefinitionsByKind("task");
    await logger.debug("Registered tasks", {
      data: { taskIds: allTasks.map((task) => task.id) },
    });
  })
  .build();
```

Reach for these internal services when you are building framework-level behavior, not for normal business code. If a higher-level API exists, prefer that first.
