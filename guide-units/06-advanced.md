## Advanced Patterns

This section covers patterns for building resilient, distributed applications. Use these when your app grows beyond a single process or needs to handle partial failures gracefully.

---

## Optional Dependencies

Optional dependencies are for components that may not be registered in a given runtime (for example local dev, feature-flagged modules, or partial deployments).
They are not a substitute for retry/circuit-breaker logic when a registered dependency fails at runtime.

### The Problem

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

### The Solution

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

### When to Use Optional Dependencies

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

Use the **ExecutionJournal** when middleware and tasks must share execution-local state without polluting task input/output contracts.

### Example: Correlation ID shared across middleware and task

```typescript
import { journal, r } from "@bluelibs/runner";

const correlationIdKey = journal.createKey<string>("app.correlationId");

const correlationMiddleware = r.middleware
  .task("app.middleware.correlation")
  .run(async ({ task, next, journal }) => {
    const correlationId = `${Date.now()}-${task.definition.id}`;
    journal.set(correlationIdKey, correlationId);
    return next(task.input);
  })
  .build();

const processOrder = r
  .task("app.tasks.processOrder")
  .middleware([correlationMiddleware])
  .run(async (_input, _deps, context) => {
    const correlationId = context.journal.get(correlationIdKey);
    return { correlationId, ok: true };
  })
  .build();
```

### Best practices

- Define and export journal keys once per domain (`journal.createKey<T>(...)`) so middleware/tasks share a typed contract.
- Keep fail-fast semantics: duplicate `set()` calls should throw unless mutation is truly intentional (`{ override: true }`).
- Forward `journal` explicitly in nested task calls only when child work must share the same execution context.

For the full API surface and patterns, see the Execution Journal section in [Core Concepts](#execution-journal).

---

## Execution Interception APIs

Use interception when behavior must wrap execution globally or at runtime wiring boundaries.

Available APIs:

- Task catch-all: `taskRunner.intercept((next, input) => Promise<any>, { when? })`
- Task middleware layer: `middlewareManager.intercept("task", (next, input) => Promise<any>)`
- Resource middleware layer: `middlewareManager.intercept("resource", (next, input) => Promise<any>)`
- Per-middleware: `middlewareManager.interceptMiddleware(middleware, interceptor)`
- Event emission: `eventManager.intercept((next, event) => Promise<void>)`
- Hook execution: `eventManager.interceptHook((next, hook, event) => Promise<any>)`
- Local task interception: `deps.someTask.intercept((next, input) => Promise<any>)`

`taskRunner.intercept(...)` is the replacement for old middleware catch-all behavior:

```typescript
import { r } from "@bluelibs/runner";

const telemetryInstaller = r
  .resource("app.telemetry")
  .dependencies({
    taskRunner: resources.taskRunner,
    logger: resources.logger,
  })
  .init(async (_config, { taskRunner, logger }) => {
    taskRunner.intercept(
      async (next, input) => {
        const startedAt = Date.now();
        try {
          return await next(input);
        } finally {
          await logger.info(
            `Task ${input.task.definition.id} took ${Date.now() - startedAt}ms`,
          );
        }
      },
      {
        when: (taskDefinition) => !taskDefinition.id.startsWith("internal."),
      },
    );
  })
  .build();
```

Notes:

- Register interceptors during resource `init` before the runtime locks.
- `taskRunner.intercept(...)` runs outermost around the task middleware pipeline.
- `deps.someTask.intercept(...)` runs inside task middleware and only for that task.

---

## Task Interceptors

_Resources can dynamically modify task behavior during initialization_

Task interceptors (`task.intercept()`) are the modern replacement for component lifecycle events, allowing resources to dynamically modify task behavior without tight coupling.

```typescript
import { r, run } from "@bluelibs/runner";

const calculatorTask = r
  .task("app.tasks.calculator")
  .run(async (input: { value: number }) => {
    console.log("3. Task is running...");
    return { result: input.value + 1 };
  })
  .build();

const interceptorResource = r
  .resource("app.interceptor")
  .dependencies({ calculatorTask })
  .init(async (_config, { calculatorTask }) => {
    // Intercept the task to modify its behavior
    calculatorTask.intercept(async (next, input) => {
      console.log("1. Interceptor before task run");
      const result = await next(input);
      console.log("4. Interceptor after task run");
      return { ...result, intercepted: true };
    });
  })
  .build();

const app = r
  .resource("app")
  .register([calculatorTask, interceptorResource])
  .dependencies({ calculatorTask })
  .init(async (_config, { calculatorTask }) => {
    console.log("2. Calling the task...");
    const result = await calculatorTask({ value: 10 });
    console.log("5. Final result:", result);
    // Final result: { result: 11, intercepted: true }
  })
  .build();

await run(app);
```

You can inspect which resources installed local interceptors through an injected task dependency:

```typescript
const inspector = r
  .resource("app.inspector")
  .dependencies({ calculatorTask })
  .init(async (_config, { calculatorTask }) => {
    const owners = calculatorTask.getInterceptingResourceIds();
    // eg: ["app.interceptor"]
    return { owners };
  })
  .build();
```

> **runtime:** "'Modern replacement for lifecycle events.' Adorable rebrand for 'surgical monkey‑patching.' You're collapsing the waveform of a task at runtime and I'm Schrödinger's runtime, praying the cat hasn't overridden `run()` with `throw new Error('lol')`."

## Durable Workflows (Node-only)

Durable workflows provide replay-safe, crash-recoverable orchestration primitives:

- `ctx.step(...)` for deterministic checkpoints
- `ctx.sleep(...)` for durable timers
- `ctx.waitForSignal(...)` for durable external synchronization
- `ctx.switch(...)` for replay-safe branching

Use them when business processes must survive process restarts and resume correctly.

See [Durable Workflows](../readmes/DURABLE_WORKFLOWS.md) for complete API and patterns.

---

## Remote Lanes: Bridging Runners

Remote Lanes are the distributed execution model for Runner. They let you expose tasks and events over HTTP, making them callable from other processes, services, or a browser UI. This allows a server and client to co-exist, enabling one Runner instance to securely call another.

Here's a sneak peek of how you can expose your application and configure RPC lane routing for remote execution:

```typescript
import { r } from "@bluelibs/runner";
import { rpcLanesResource } from "@bluelibs/runner/node";

let app = r.resource("app");

const lane = r
  .rpcLane("app.rpc.main")
  .policy({ middlewareAllowList: ["app.middleware.task.audit"] })
  .build();

const topology = r.rpcLane.topology({
  profiles: {
    client: { serve: [] },
  },
  bindings: [{ lane, communicator: r.rpcLane.http() }],
});

app = app
  .register([
    // ... your tasks and events tagged with tags.rpcLane.with({ lane })
    rpcLanesResource.with({
      profile: "client",
      topology,
      mode: "network",
      exposure: {
        http: {
          basePath: "/__runner",
          listen: { port: 7070 },
        },
      },
    }),
  ])
  .build();
```

This is just a glimpse. With remote lanes, you can build microservices, CLIs, and admin panels that interact with your main application securely and efficiently.

For typed remote error hydration, pass an `errorRegistry` to the client:

```typescript
// Assuming: AppError = r.error<{ code: number }>("app.errors.AppError").build()
const client = createClient({
  url: "http://remote-runner:8080/__runner",
  errorRegistry: new Map([[AppError.id, AppError]]),
});
```

For a deep dive into streaming, authentication, file uploads, and more, check out the [full Remote Lanes documentation](../readmes/REMOTE_LANES.md).

Remote lane auth tip:

- Keep exposure auth and lane auth separate:
  - `exposure.http.auth` controls who can call the HTTP endpoints.
  - `binding.auth` controls lane-level JWT authorization.
- Configure lane JWT mode/material on topology bindings (`binding.auth`), not on lane definitions.
- `local-simulated` mode still enforces lane auth when `binding.auth` is enabled, so local simulations cover both serializer boundaries and JWT checks.
- In `network` mode, both RPC and Event Lanes follow the same asymmetric role split:
  - producer role requires private key (signer)
  - consumer role requires public key (verifier)
- For `jwt_asymmetric`, prove both sides:
  - Producer runtime without private key must fail fast (`runner.errors.remoteLanes.auth.signerMissing`).
  - Consumer runtime without public key must fail fast (`runner.errors.remoteLanes.auth.verifierMissing`).

---

## Resilience Orchestration

In production, one resilience strategy is rarely enough. Runner allows you to compose multiple middleware layers into a "resilience onion" that protects your business logic from multiple failure modes.

### The Problem

A task that calls a remote API might fail due to network blips (needs **Retry**), hang indefinitely (needs **Timeout**), slam the API during traffic spikes (needs **Rate Limit**), or keep failing if the API is down (needs **Circuit Breaker**).

### The Solution

Combine them in the correct order. Like an onion, the outer layers handle broader concerns, while inner layers handle specific execution details.

```typescript
import { r } from "@bluelibs/runner";

const resilientTask = r
  .task("app.tasks.ultimateResilience")
  .middleware([
    // Outer layer: Fallback (the absolute Plan B if everything below fails)
    middleware.task.fallback.with({
      fallback: { status: "offline-mode", data: [] },
    }),

    // Next: Rate Limit (check this before wasting resources or retry budget)
    middleware.task.rateLimit.with({ windowMs: 60000, max: 100 }),

    // Next: Circuit Breaker (stop immediately if the service is known to be down)
    middleware.task.circuitBreaker.with({ failureThreshold: 5 }),

    // Next: Retry (wrap the attempt in a retry loop)
    middleware.task.retry.with({ retries: 3 }),

    // Inner layer: Timeout (enforce limit on EACH individual attempt)
    middleware.task.timeout.with({ ttl: 5000 }),
  ])
  .run(async () => {
    return await fetchDataFromUnreliableSource();
  })
  .build();
```

### Best Practices for Orchestration

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

## Overrides

Sometimes you need to replace a component entirely. Maybe you're doing integration testing or you want to override a library from an external package.

Use `r.override(base, fn)` for behavior swaps while preserving the same `id`.

Override direction is downstream-only: declare `.overrides([...])` from the resource that owns the target subtree, or from one of its ancestors. Child resources cannot silently replace definitions owned by a parent or a sibling subtree.

```typescript
import { r } from "@bluelibs/runner";

const productionEmailer = r
  .resource("app.emailer")
  .init(async () => new SMTPEmailer())
  .build();

// Option 1: Namespace form
const shorthandOverrideEmailer = r.override(
  productionEmailer,
  async () => new MockEmailer(),
);

const app = r
  .resource("app")
  .register([productionEmailer])
  .overrides([shorthandOverrideEmailer])
  .build();

// Tasks
const originalTask = r
  .task("app.tasks.compute")
  .run(async () => 1)
  .build();
const overriddenTask = r.override(originalTask, async () => 2);

// Resources
const originalResource = r
  .resource("app.db")
  .init(async () => "conn")
  .build();
const overriddenResource = r.override(
  originalResource,
  async () => "mock-conn",
);

// Middleware
const originalMiddleware = r.middleware
  .task("app.middleware.log")
  .run(async ({ next }) => next())
  .build();
const overriddenMiddleware = r.override(
  originalMiddleware,
  async ({ task, next }) => {
    const result = await next(task?.input);
    return { wrapped: result };
  },
);

// Even hooks
```

`r.override(base, fn)` is behavior-only:

- task/hook/task-middleware/resource-middleware: callback replaces `run`
- resource: callback replaces `init`
- hook overrides keep the same `.on` target

Override APIs do not change structural boundaries (dependencies, register tree, subtree policies). If you need a separate structural variant, compose a distinct parent resource explicitly. Use `.fork("new-id")` only for leaf resources.

### `r.override(...)` vs `.overrides([...])` (Critical Distinction)

These APIs solve different problems:

| API                    | What it does                                                                                 | Applies replacement? |
| ---------------------- | -------------------------------------------------------------------------------------------- | -------------------- |
| `r.override(base, fn)` | Creates a new definition object with replaced behavior (`init` or `run`)                     | No (not by itself)   |
| `.overrides([...])`    | Registers override _application requests_ that Runner validates and applies during bootstrap | Yes                  |

Think of `r.override(...)` as **"build replacement definition"** and `.overrides([...])` as **"apply replacement in this app"**.

```typescript
const mockMailer = r.override(realMailer, async () => new MockMailer()); // definition only

const app = r
  .resource("app")
  .register([realMailer])
  .overrides([mockMailer]) // replacement is applied here
  .build();
```

Important: `.overrides([...])` only accepts definitions produced by `r.override(...)` (plus `null` / `undefined` for conditional lists).

Direct registration of an override definition is also valid when you control the composition and only register one version for that id:

```typescript
const customMailer = r.override(realMailer, async () => new MockMailer());

const app = r
  .resource("app")
  .register([customMailer]) // works: this is just the definition registered for that id
  .build();
```

### Common Pitfalls (and Fixes)

1. Creating an override but never applying/registering it:

```typescript
const mockMailer = r.override(realMailer, async () => new MockMailer());
await run(app); // no effect if app doesn't include mockMailer
```

Fix: register it directly or include it in `.overrides([...])`.

2. Registering both base and override in `.register([...])`:

```typescript
.register([realMailer, r.override(realMailer, async () => new MockMailer())])
```

Fix: either register only one definition for that id, or keep base in `register` and place replacement in `.overrides([...])`.

3. Using `.overrides([...])` when target id is not registered:

```typescript
.overrides([r.override(remoteMailer, async () => new MockMailer())])
```

Fix: ensure the base target is in the resource graph first. If you wanted a separate resource, use a different id. For leaf resources you can `.fork("new-id")`; for non-leaf resources compose a distinct parent resource.

4. Passing raw definitions to `.overrides([...])`:

```typescript
.overrides([r.resource("app.mailer").init(async () => new MockMailer()).build()])
```

Fix: wrap the base with `r.override(base, fn)` before adding it to `.overrides([...])`.

5. Overriding the root app directly in tests when a wrapper is clearer:

Fix: prefer:

```typescript
r.resource("test")
  .register([app])
  .overrides([
    /* mocks */
  ])
  .build();
```

Overrides are applied after everything is registered. If multiple overrides target the same id, Runner rejects the graph with a dedicated duplicate-target override error (instead of applying precedence). Overriding something that wasn't registered also throws a dedicated error with remediation (register the base first, or use a different resource id when you meant a separate instance). Use `r.override()` to change behavior safely while preserving the original id.

> **runtime:** "Overrides: brain transplant surgery at runtime. You register a penguin and replace it with a velociraptor five lines later. Tests pass. Production screams. I simply update the name tag and pray."

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
| Error               | `InvalidInput` -> `app.errors.InvalidInput`        |
| Async Context       | `request` -> `app.ctx.request`                     |

Important behavior:

- Inside `run(...)`, middleware, hooks, lane policies, and validators, `definition.id` is always the canonical runtime ID.
- Original definition objects are not mutated; per-run compiled definitions are stored internally (run isolation safe).
- Canonical ids are composed structurally from owner resources; prefer local definition ids and reference-based wiring.
- Use `defineResource({ id, gateway: true })` for namespace gateways when a resource should not add its own segment to compiled canonical ids.
- Local names fail fast if they use reserved segments: `tasks`, `resources`, `events`, `hooks`, `tags`, `errors`, `ctx`.
- All definition ids fail fast when they start/end with `.`, contain empty segments (`..`), or equal a reserved standalone local name.

> **runtime:** "You give me short names in your little subtree village. I issue passports with full addresses at the border. Everybody wins, and nobody argues about dots all day."

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

## Type Contracts

Consider this: You have an authentication tag, and you want to ensure ALL tasks using it actually accept a `userId` in their input. TypeScript doesn't know about your tags—it can't enforce that every task using auth has the right input shape. How do you make this compile-time enforced?

**The problem**: You want to enforce that tasks using certain tags or middleware conform to specific input/output shapes, but plain TypeScript types can't express "any task with tag X must have property Y."

**The naive solution**: Document the requirements and add runtime checks. But this is error-prone and bugs aren't caught until runtime.

**The better solution**: Use Type Contracts, which allow Tags and Middleware to declare input/output contracts that are enforced at compile time.

### When to Use Type Contracts

| Use case            | Why Type Contracts help                |
| ------------------- | -------------------------------------- |
| Authentication      | Ensure all auth tasks include userId   |
| API standardization | Enforce consistent response shapes     |
| Validation          | Guarantee tasks return required fields |
| Documentation       | Make requirements self-enforcing       |

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

When you call `run(app)`, Runner creates an isolated runtime for that specific run. During bootstrap, it registers built-in system resources for that app, including `resources.runtime`.

`resources.runtime` resolves to the same runtime object returned by `run(app)`, scoped to that app only. This lets code running _inside_ the app depend on `runtime` and perform runtime operations (`runTask`, `emitEvent`, `getResourceValue`, root helpers, etc.) without passing the outer runtime object around manually.

Bootstrap timing note: inside resource `init()`, `runtime` is available early, but that does **not** mean every registered resource is initialized yet. Runner guarantees dependency readiness for the currently initializing resource; unrelated resources may still be pending (especially with `lifecycleMode: "parallel"` or `lazy: true`).

```typescript
import { r } from "@bluelibs/runner";

const advancedTask = r
  .task("app.advanced")
  .dependencies({
    // Available because run(app) provides this resource to the current app.
    runtime: resources.runtime,
    store: resources.store,
    taskRunner: resources.taskRunner,
    eventManager: resources.eventManager,
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

Consider this graph that creates a circular _type inference_ dependency:

```typescript
// FILE: a.ts
export const aResource = r
  .resource("a.resource")
  .dependencies({ b: bResource })
  .init(async () => "a")
  .build();

export const aTask = r
  .task("a.tasks.run")
  .dependencies({ a: aResource })
  .run(async () => "ok")
  .build();

// FILE: b.ts
export const bResource = r
  .resource("b.resource")
  .dependencies({ c: cResource })
  .init(async () => "b")
  .build();

// FILE: c.ts
export const cResource = r
  .resource("c.resource")
  .dependencies({ aTask }) // Creates circular type inference across files.
  .init(async (_config, { aTask }) => `C depends on ${await aTask(undefined)}`)
  .build();
```

A depends on B, B depends on C, and C depends on A's task. Runtime can still boot, but TypeScript inference can get stuck in this cycle.

### The Solution

The fix is to explicitly type the resource that completes the circle using `IResource<TConfig, Promise<TValue>, TDependencies>`. This breaks the inference chain while maintaining runtime behavior:

```typescript
// c.resource.ts - The key change
import type { IResource } from "@bluelibs/runner";

export const cResource = r
  .resource("c.resource")
  .dependencies({ a: aResource })
  .init(async (_config, { a }) => `C depends on ${a}`)
  .build() as IResource<void, Promise<string>>;
```

#### Why This Works

- **Runtime**: The circular dependency still works at runtime because the framework resolves dependencies dynamically
- **TypeScript**: The explicit type annotation prevents TypeScript from trying to infer the return type based on the circular chain
- **Type Safety**: You still get full type safety by explicitly declaring the return type (`string` in this example)

#### Best Practices

1. **Identify the "leaf" resource**: Choose the resource that logically should break the chain (often the one that doesn't need complex type inference)
2. **Use explicit typing**: Add `IResource<Config, Promise<Value>, Dependencies>` annotation
3. **Document the decision**: Add a comment explaining why the explicit typing is needed
4. **Consider refactoring**: If you have many circular dependencies, consider if your architecture could be simplified

#### Example with Dependencies

If your resource has dependencies, include them in the type:

```typescript
type MyDependencies = {
  someService: SomeServiceType;
  anotherResource: AnotherResourceType;
};

export const problematicResource = r
  .resource("problematic.resource")
  .dependencies({
    /* ... */
  })
  .init(async (config, deps) => {
    // Your logic here
    return someComplexObject;
  })
  .build() as IResource<void, Promise<ComplexReturnType>, MyDependencies>;
```

This pattern allows you to maintain clean, type-safe code while handling the inevitable circular dependencies that arise in complex applications.

> **runtime:** "Circular dependencies: Escher stairs for types. You serenade the compiler with 'as IResource' and I do the parkour at runtime. It works. It's weird. Nobody tell the linter."
