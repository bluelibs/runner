## Resources

Resources are the long-lived parts of your app: database clients, configuration surfaces, queues, services, caches, and ownership boundaries.
They initialize once, participate in runtime lifecycle phases, and give tasks a stable dependency surface.
They are also the main composition unit in Runner: a resource can own registration, enforce boundaries, expose a value, and define how that part of the system starts and stops.

Most apps begin by building a root resource and passing it to `run(...)`:

```typescript
import { r, run } from "@bluelibs/runner";

const app = r
  .resource("app")
  .register([
    // tasks, events, middleware, child resources
  ])
  .build();

const runtime = await run(app);
```

Once `run(app)` resolves, the returned runtime is your operator-facing handle. The main APIs are:

- `runtime.runTask(...)` to execute tasks
- `runtime.emitEvent(...)` to emit events
- `runtime.getResourceValue(...)` and `runtime.getLazyResourceValue(...)` to read resource values
- `runtime.getResourceConfig(...)` to inspect resolved resource config
- `runtime.getHealth(...)` to evaluate resource health probes
- `runtime.pause()`, `runtime.resume()`, and `runtime.recoverWhen(...)` to control admissions
- `runtime.dispose()` to stop the runtime cleanly

```typescript
import { r } from "@bluelibs/runner";
import { MongoClient } from "mongodb";

type UserData = {
  email: string;
};

const database = r
  .resource("database")
  .init(async () => {
    const client = new MongoClient(process.env.DATABASE_URL as string);
    await client.connect();
    return client;
  })
  .dispose(async (client) => client.close())
  .build();

const userService = r
  .resource("userService")
  .dependencies({ database })
  .init(async (_config, { database }) => ({
    async createUser(userData: UserData) {
      return database.collection("users").insertOne(userData);
    },
    async getUser(id: string) {
      return database.collection("users").findOne({ _id: id });
    },
  }))
  .build();
```

This example assumes the `mongodb` package is installed and `DATABASE_URL` is set.

**What you just learned**: Resources define `init` for creation and `dispose` for cleanup. Dependencies are declared explicitly, and the builder pattern produces a frozen definition.

When you want operator-facing health data, keep the probe small and explicit:

```typescript
const database = r
  .resource("database")
  .init(async () => connectDb())
  .health(async (client) => ({
    status: client?.isConnected() ? "healthy" : "unhealthy",
    message: "database connectivity",
  }))
  .build();
```

### Health Reporting

`health()` is opt-in and pull-based. Runner does not call it automatically during every lifecycle phase. It only runs when you ask for a report.

Runner exposes the same health reporter in two places:

- `resources.health` is a built-in global resource exported through the `resources` namespace. Inject it when you want health checks from inside Runner-managed code.
- `runtime.getHealth(...)` is the operator-facing shortcut on the runtime instance.

Use `resources.health` inside resources, hooks, or tasks when you are already in the dependency graph:

```typescript
import { resources, r } from "@bluelibs/runner";

const app = r
  .resource("app")
  .dependencies({ health: resources.health, logger: resources.logger })
  .ready(async (_value, _config, { health, logger }) => {
    const report = await health.getHealth([database]);
    const databaseEntry = report.find(database);

    if (databaseEntry.status === "unhealthy") {
      await logger.error("Database health check failed", {
        resourceId: databaseEntry.id,
        message: databaseEntry.message,
        details: databaseEntry.details,
      });
    }
  })
  .build();
```

Use `runtime.getHealth(...)` from operator-facing code after `run(app)` resolves:

```typescript
import { resources } from "@bluelibs/runner";

const runtime = await run(app);
const logger = runtime.getResourceValue(resources.logger);

const report = await runtime.getHealth();

const databaseStatus = report.find(database).status;

if (databaseStatus !== "healthy") {
  await logger.error("Operator health check detected a problem", {
    totals: report.totals,
    database: report.find(database),
  });
}
```

The report shape is:

```typescript
{
  totals: {
    resources: number;
    healthy: number;
    degraded: number;
    unhealthy: number;
  };
  report: Array<{
    id: string;
    initialized: boolean;
    status: "healthy" | "degraded" | "unhealthy";
    message?: string;
    details?: unknown;
  }>;
  find(resourceOrId): HealthEntry;
}
```

Important behavior:

- resources without `health()` are skipped instead of receiving a synthetic status
- lazy resources that were never initialized stay asleep and are skipped instead of being probed
- filtered calls such as `getHealth([database])` accept resource definitions or ids
- repeated filtered resources are de-duplicated
- unknown requested resources fail fast
- if `health()` throws, Runner converts that into an `unhealthy` entry with the error message in `message` and the normalized error in `details`
- `report.find(...)` throws when the requested resource is not present in the report
- `id` in each report entry is the canonical runtime path for that resource

Timing matters:

- call `runtime.getHealth(...)` only after `run(...)` resolves and before disposal starts
- do not call `resources.health.getHealth(...)` during bootstrap from `init()`; prefer `ready()` or later

Prefer health probes for current operational state, not deep diagnostics. Keep them fast, explicit, and safe to run on demand.

When a health signal indicates temporary pressure or a downstream outage, use runtime admission control instead of tearing the system down:

```typescript
const runtime = await run(app);

runtime.pause("database is unhealthy");

runtime.recoverWhen({
  everyMs: 5_000,
  check: async () => {
    const report = await runtime.getHealth([database]);
    return report.find(database).status !== "unhealthy";
  },
});
```

`runtime.pause()` is not shutdown. It simply stops admitting new runtime-origin and resource-origin task runs and event emissions while already-running work continues. `runtime.recoverWhen({ everyMs, check })` polls your recovery condition and automatically resumes the runtime once the active paused episode is healthy enough to accept work again.

### Lifecycle and Ownership Rules

Resources move through a deliberate sequence of phases. Understanding which phase to use—and which to leave alone—prevents subtle shutdown bugs. All lifecycle methods are async.

- `init(config, deps, context)` creates the resource value
- `ready(value, config, deps, context)` starts ingress after startup lock
- `runtime.getLazyResourceValue(...)` can wake a startup-unused lazy resource only before shutdown starts; once the runtime enters `coolingDown` or later, that wakeup is rejected fail-fast.
- `cooldown(value, config, deps, context)` stops new ingress **quickly**, a way of saying "stop any additional work, but let in-flight work finish".
  When `dispose.cooldownWindowMs` is greater than `0`, Runner keeps the broader `coolingDown` admission policy open for that bounded post-cooldown window before it enters `disposing`. At the default `0`, Runner skips that wait. Once `disposing` begins, admissions narrow to in-flight continuations plus resource-origin calls from the cooling resource itself and any additional resource definitions returned from `cooldown()`.
- `dispose(value, config, deps, context)` performs final teardown after task/event drain.
- Config-only resources can omit `.init()` and resolve to `undefined`
- user resources contribute their own ownership segment to canonical ids
- the app resource passed to `run(...)` is a normal resource, so direct registrations compile as `app.tasks.x`, `app.events.x`, `app.middleware.task.x`, and so on
- child resources continue that chain, so nested registrations compile as `app.billing.tasks.x`
- only the internal synthetic framework root is transparent, and it does not appear in user-facing ids
- `runtime-framework-root` is reserved for that internal framework root and cannot be used as a user resource id
- If a resource declares `.register(...)`, it is non-leaf and cannot be forked
- `.context(() => initialContext)` provides private and mutable resource-local state shared across lifecycle methods

Do not use `cooldown()` as a general teardown phase for support resources such as databases. Cooldown is designed for ingress points that need to stop accepting new work quickly while letting in-flight work finish.

### Resource Configuration

Resources can be configured with type-safe options.

```typescript
import { r } from "@bluelibs/runner";

type SMTPConfig = {
  smtpUrl: string;
  from: string;
};

const emailer = r
  .resource<SMTPConfig>("emailer")
  .init(async (config) => ({
    send: async (to: string, subject: string, body: string) => {
      // Use config.smtpUrl and config.from
    },
  }))
  .build();

const app = r
  .resource("app")
  .register([
    emailer.with({
      smtpUrl: "smtp://localhost",
      from: "noreply@myapp.com",
    }),
  ])
  .build();
```

### Dynamic Registration and Dependencies

Both `.register()` and `.dependencies()` accept functions when behavior depends on config or environment.

`.register()` as a function — when the registered set depends on config:

```typescript
import { r } from "@bluelibs/runner";

const auditLog = r
  .resource("auditLog")
  .init(async () => ({ write: (message: string) => console.log(message) }))
  .build();

const feature = r
  .resource<{ enableAudit: boolean }>("feature")
  .register((config) => (config.enableAudit ? [auditLog] : []))
  .init(async () => ({ enabled: true }))
  .build();
```

`.dependencies()` as a function — when dependencies are conditional or config-driven:

```typescript
const advancedService = r
  .resource("app.services.advanced")
  .dependencies((_config, mode) => ({
    database,
    logger,
    conditionalService: mode === "prod" ? serviceA : serviceB,
  }))
  .init(async (_config, { database, logger, conditionalService }) => {
    // Same interface as static dependencies
  })
  .build();
```

Use function-based patterns when:

- registered components or dependencies depend on config
- you want one reusable template with environment-specific wiring
- you need to avoid registering optional components in every environment
- you have conditional dependencies based on the resource's `.with(...)` config

**Performance note**: Function-based dependencies have minimal overhead — they're called once during dependency resolution.

### Dependency Resolution Strategy

Runner resolves dependency trees into ordered initialization waves during `run(app)`.
By default, initialized resources run `init()` sequentially.
Set `lifecycleMode: "parallel"` to execute independent resources concurrently within their dependency-safe wave:

```typescript
const runtime = await run(app, {
  lifecycleMode: "parallel",
  // lazy: true // Only init resources explicitly requested or needed
});
```

This speeds up boot times when multiple resources (like DBs or queues) don't depend on each other.

### Circular Type Dependencies (TypeScript)

In the rare scenarios, when your file structure creates mutual imports for example:

- resources 'A' registers task 'T'
- task 'T' depends on resource 'A'
- both 'A' and 'T' are defined in separate files

This is allowed in runtime, but TypeScript's static analysis will complain about circular type dependencies. And it defaults it to `any` and transforming register() and dependencies() to functions does not help because the circular dependency is still there.

The solution is to cast register() from resource 'A' to return `RegisterableItem[]` instead of the inferred tuple type. This breaks the circular type dependency while preserving autocompletion.

```typescript
import { r } from "@bluelibs/runner";
import type { RegisterableItem } from "@bluelibs/runner";

const t = r.resource("A").register((): RegisterableItem[] => {
  return [taskT];
});
```

If you encounter other, more complex circular type dependencies, consider casting the entire resource to `IResource`.

### Resource Forking

Fork a leaf resource when you need the same resource behavior under a new identity.

```typescript
import { r } from "@bluelibs/runner";

const mailerBase = r
  .resource<{ smtp: string }>("mailerBase")
  .init(async (cfg) => ({
    send: (to: string) => console.log(`Sending via ${cfg.smtp} to ${to}`),
  }))
  .build();

export const txMailer = mailerBase.fork("txMailer");
export const marketingMailer = mailerBase.fork("marketingMailer");

const orderService = r
  .task("processOrder")
  .dependencies({ mailer: txMailer })
  .run(async (input, { mailer }) => {
    mailer.send(input.customerEmail);
  })
  .build();
```

Fork rules:

- `.fork()` returns a built `IResource`; do not call `.build()` again
- forks clone identity, not structure
- tags, middleware, and type parameters are inherited
- each fork gets independent runtime state
- non-leaf resources must be composed explicitly

### Resource Exports and Isolation Boundaries

Use `.isolate({ exports: [...] })` to define a public surface for a resource subtree and keep everything else private.
When the boundary depends on resource config, use `.isolate((config) => ({ ... }))`.

```typescript
import { r } from "@bluelibs/runner";

const calculateTax = r
  .task("calculateTax")
  .run(async (amount: number) => amount * 0.1)
  .build();

const createInvoice = r
  .task("createInvoice")
  .dependencies({ calculateTax })
  .run(
    async (amount: number, deps) => amount + (await deps.calculateTax(amount)),
  )
  .build();

const billing = r
  .resource("billing")
  .register([calculateTax, createInvoice])
  .isolate({ exports: [createInvoice] })
  // calculateTax will not be visible/usable to resources outside of billing, but createInvoice will be
  .build();
```

Semantics:

- No `isolate.exports` means everything remains public
- `exports: []` or `exports: "none"` makes the subtree private
- `exports` accepts explicit Runner definition or resource references only
- `.isolate((config) => ({ ... }))` resolves once per configured resource instance
- Visibility checks cover dependencies, hook `.on(...)`, tag attachments, and middleware attachment
- Exporting a child resource makes that child's own exported surface transitively visible
- Validation happens during `run(app)`, not declaration time
- Runtime operator APIs are gated only by the root resource's exported surface

Migration note:

- Legacy resource-level `exports` and fluent `.exports(...)` were removed in 6.x
- Use `isolate: { exports: [...] }` with `defineResource(...)`
- Use `.isolate({ exports: [...] })` with fluent builders

### Wiring Access Policy

Use `.isolate({ deny: [...] })`, `.isolate({ only: [...] })`, and `.isolate({ whitelist: [...] })` when visibility alone is not enough.

```typescript
import { r, scope, subtreeOf } from "@bluelibs/runner";

const internalDb = r
  .resource("internalDb")
  .init(async () => ({}))
  .build();

const internalOnlyTag = r.tag("internalOnly").build();

const billing = r
  .resource("billing")
  .register([internalDb, internalOnlyTag])
  .isolate({
    deny: [internalDb, scope([internalOnlyTag], { tagging: false })],
  })
  .build();

const agentTask = r
  .task("agentTask")
  .run(async () => "agent")
  .build();
const agentResource = r.resource("agent").register([agentTask]).build();

const selective = r
  .resource("selective")
  .isolate({
    only: [subtreeOf(agentResource, { types: ["task"] })],
  })
  .build();
```

Mental model:

- `exports` answers: "what does this subtree expose to the outside?"
- `deny` / `only` / `whitelist` answer: "what may consumers inside this subtree wire to across boundaries?"
- Use a direct definition/resource/tag reference for one concrete item.
- Use `subtreeOf(resource, { types? })` for "everything owned by that resource subtree".
- Use `scope(target, channels?)` when the rule should only affect selected channels.

Selector rules:

- `deny` and `only` are mutually exclusive on the same resource
- `deny` and `only` accept definitions, `subtreeOf(...)`, or `scope(...)`
- `whitelist` uses `{ for: [...], targets: [...], channels? }`, and `for` / `targets` accept the same selector forms as `deny` / `only`
- bare strings are invalid in isolation policies; use string selectors only inside `scope(...)`
- `scope("*")` means "everything"
- `scope("system.*")` means "all registered canonical ids matching that segment wildcard"
- `subtreeOf(resource)` is ownership-based, not string-prefix-based
- `.isolate((config) => ({ ... }))` can switch `deny`, `only`, `whitelist`, and `exports` from resource config

Behavior rules:

- `deny` blocks matching cross-boundary references
- `only` allows only matching cross-boundary references
- `whitelist` adds carve-outs for specific consumer -> target relations on this boundary only
- `whitelist` does not override ancestor isolation rules
- `whitelist` does not make private exports public
- enforcement covers dependencies, listening, tagging, and middleware channels
- parent and child isolation rules compose additively
- unknown targets and selector patterns that resolve to nothing fail fast at bootstrap

### Subtree Policies

Resources also support `.subtree(policy)`, `.subtree([policyA, policyB])`, and `.subtree((config) => policy | policy[])` for subtree-wide middleware and validation.

Keep the two APIs distinct:

- `subtreeOf(resource, { types })` is an isolation selector used inside `.isolate(...)`
- `.subtree({ validate })` is a generic resource policy hook that inspects compiled definitions in that resource subtree
- `.subtree([policyA, policyB])` applies multiple subtree policies in declaration order
- `.subtree((config) => ({ ... }))` and `.subtree((config) => [{ ... }, { ... }])` let subtree policy depend on the owning resource config
- `subtree.validate` can be one function or an array of functions
- typed validator branches are also available on `tasks`, `resources`, `hooks`, `events`, `tags`, `taskMiddleware`, and `resourceMiddleware`
- if subtree middleware and local middleware resolve to the same middleware id on one target, Runner fails fast

Use the generic validator with exported type guards when you need type-specific checks:

```typescript
import { isResource, isTask, r, run } from "@bluelibs/runner";
import type { SubtreeViolation } from "@bluelibs/runner";

const app = r
  .resource("app")
  .subtree({
    validate: (definition): SubtreeViolation[] => {
      const violations: SubtreeViolation[] = [];
      if (isTask(definition) && !definition.meta?.title) {
        violations.push({
          code: "missing-task-title",
          message: `Task "${definition.id}" must define meta.title`,
        });
      }

      if (isResource(definition) && definition.init == null) {
        violations.push({
          code: "resource-must-init",
          message: `Resource "${definition.id}" must define init()`,
        });
      }

      return violations;
    },
  })
  .build();

await run(app);
```

Use typed branches when you want item-specific validation without runtime guards:

```typescript
const app = r
  .resource<{ strict: boolean }>("app")
  .subtree((config) => ({
    validate: config.strict
      ? (definition) =>
          isTask(definition) && !definition.meta?.title
            ? [
                {
                  code: "missing-task-title",
                  message: `Task "${definition.id}" must define meta.title`,
                },
              ]
            : []
      : [],
    tasks: {
      validate: (task) =>
        task.meta?.title
          ? []
          : [
              {
                code: "missing-task-title",
                message: `Task "${task.id}" must define meta.title`,
              },
            ],
    },
    taskMiddleware: {
      validate: (middleware) =>
        middleware.meta?.title
          ? []
          : [
              {
                code: "missing-task-middleware-title",
                message: `Task middleware "${middleware.id}" must define meta.title`,
              },
            ],
    },
  }))
  .build();
```

Validation rules:

- validators receive compiled definitions, not raw builder state
- generic and typed validators both run when they match the same definition
- use exported guards such as `isTask(...)`, `isResource(...)`, `isEvent(...)`, `isHook(...)`, `isTag(...)`, `isTaskMiddleware(...)`, and `isResourceMiddleware(...)`
- return `SubtreeViolation[]` for expected policy failures
- do not throw for normal validation failures

### Optional Dependencies

Optional dependencies are for components that may not be registered in a given runtime (for example local dev, feature-flagged modules, or partial deployments).
They are not a substitute for retry/circuit-breaker logic when a registered dependency fails at runtime.

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

`optional()` handles dependency absence (`undefined`) at wiring time.
If a registered dependency throws, handle that with retry/fallback/circuit-breaker patterns.

Optional dependencies work on tasks, resources, events, async contexts, and errors.

| Use Case                  | Example                                            |
| ------------------------- | -------------------------------------------------- |
| **Non-critical services** | Analytics, metrics, feature flags                  |
| **External integrations** | Third-party APIs that may be flaky                 |
| **Development shortcuts** | Skip services not running locally                  |
| **Feature toggles**       | Conditionally enable functionality                 |
| **Gradual rollouts**      | New services that might not be deployed everywhere |

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

### Private Context

Use resource context when lifecycle methods need shared mutable state.

```typescript
import { r } from "@bluelibs/runner";

// Assuming `connectToDatabase` and `createPool` are your own collaborators.
const dbResource = r
  .resource("dbResource")
  .context(() => ({
    connections: new Map<string, unknown>(),
    pools: [] as Array<{ drain(): Promise<void> }>,
  }))
  .init(async (_config, _deps, resourceContext) => {
    const db = await connectToDatabase();
    resourceContext.connections.set("main", db);
    resourceContext.pools.push(createPool(db));
    return db;
  })
  .dispose(async (_db, _config, _deps, resourceContext) => {
    for (const pool of resourceContext.pools) {
      await pool.drain();
    }
  })
  // same for ready() and cooldown() if needed
  .build();
```

### Overrides

Use `r.override(base, fn)` when you need to replace a component's behavior while keeping the same `id` — common in integration testing or when swapping out a library.

Override direction is downstream-only: declare `.overrides([...])` from the resource that owns the target subtree, or from one of its ancestors. Child resources cannot replace definitions owned by a parent or sibling subtree.

```typescript
import { r } from "@bluelibs/runner";

const productionEmailer = r
  .resource("app.emailer")
  .init(async () => new SMTPEmailer())
  .build();

const mockEmailer = r.override(
  productionEmailer,
  async () => new MockEmailer(),
);

const app = r
  .resource("app")
  .register([productionEmailer])
  .overrides([mockEmailer])
  .build();
```

Overrides work on tasks, resources, hooks, and middleware:

```typescript
// Task
const overriddenTask = r.override(originalTask, async () => 2);

// Resource
const overriddenResource = r.override(
  originalResource,
  async () => "mock-conn",
);

const overriddenLifecycleResource = r.override(originalResource, {
  context: () => ({ closed: false }),
  init: async () => "mock-conn",
  dispose: async (_value, _config, _deps, context) => {
    context.closed = true;
  },
});

// Middleware
const overriddenMiddleware = r.override(
  originalMiddleware,
  async ({ task, next }) => {
    const result = await next(task?.input);
    return { wrapped: result };
  },
);
```

`r.override(base, fn)` is behavior-only for tasks, hooks, and middleware:

- task/hook/task-middleware/resource-middleware: callback replaces `run`
- resource function shorthand: callback replaces `init`
- resource object form may override any subset of `context`, `init`, `ready`, `cooldown`, `dispose`
- resource object-form overrides inherit unspecified lifecycle hooks from the base resource
- resource object-form overrides may add `ready`, `cooldown`, or `dispose` even if the base resource did not define them
- hook overrides keep the same `.on` target
- override APIs do not change structural boundaries (dependencies, register tree, subtree policies)
- duplicate override targets fail fast outside `test`; in `test`, the outermost declaring resource wins, and same-resource duplicates use the last declaration

Use the resource object form intentionally: overriding `context` changes the private lifecycle-state contract that `init()`, `ready()`, `cooldown()`, and `dispose()` share.

**`r.override(...)` vs `.overrides([...])` — critical distinction**:

| API                    | What it does                                                          | Applies replacement? |
| ---------------------- | --------------------------------------------------------------------- | -------------------- |
| `r.override(base, fn)` | Creates a new definition with replaced behavior                       | No (not by itself)   |
| `.overrides([...])`    | Registers override requests Runner validates and applies at bootstrap | Yes                  |

Think of `r.override(...)` as _"build replacement definition"_ and `.overrides([...])` as _"apply replacement in this app"_.

Direct registration of an override definition is also valid when you control the composition and only register one version for that id:

```typescript
const customMailer = r.override(realMailer, async () => new MockMailer());

const app = r
  .resource("app")
  .register([customMailer]) // works: only one definition registered for that id
  .build();
```

Common pitfalls:

1. **Creating an override but never applying it** — register it directly or add it to `.overrides([...])`.
2. **Registering both base and override in `.register([...])`** — keep base in `register`, put replacement in `.overrides([...])`.
3. **Override target not in the graph** — ensure the base is registered first. For a separate instance, use a different id or `.fork("new-id")`.
4. **Passing raw definitions to `.overrides([...])`** — wrap with `r.override(base, fn)` first.
5. **Overriding the root app in tests** — prefer a wrapper resource:

```typescript
r.resource("test")
  .register([app])
  .overrides([
    /* mocks */
  ])
  .build();
```

If multiple overrides target the same id, Runner rejects the graph with a duplicate-target override error outside `test` mode. In `test` mode, duplicates are allowed so a wrapper harness can replace a deeper mock, and the outermost declaring resource wins. Overriding something not registered still throws, with a remediation hint.

> **runtime:** "Overrides: brain transplant surgery at runtime. You register a penguin and replace it with a velociraptor five lines later. Tests pass. Production screams. I simply update the name tag and pray."

> **runtime:** "Resources: I nurse them to life, let them work, then mercifully pull the plug in reverse order. It's a lot like IT support, except I actually follow the runbook."
