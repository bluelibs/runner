## Resources

Resources are the long-lived parts of your app: database clients, configuration surfaces, queues, services, caches, and ownership boundaries.
They initialize once, participate in runtime lifecycle phases, and give tasks a stable dependency surface.

Resources can also expose an optional async `health(value, config, deps, context)` probe.
Only resources that explicitly define `health()` participate in `resources.health.getHealth(...)` and `runtime.getHealth(...)`.

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

Resources without `health()` are skipped entirely. Lazy resources that were never initialized stay asleep and are skipped instead of being probed.

### Lifecycle and Ownership Rules

Resources move through a deliberate sequence of phases. Understanding which phase to use—and which to leave alone—prevents subtle shutdown bugs.

- `init(config, deps, context)` creates the resource value
- `ready(value, config, deps, context)` starts ingress after startup lock
- `cooldown(value, config, deps, context)` stops new ingress quickly at shutdown start
- `dispose(value, config, deps, context)` performs final teardown after drain
- Config-only resources can omit `.init()` and resolve to `undefined`
- `r.resource(id, { gateway: true })` suppresses the resource's own namespace segment
- If a resource declares `.register(...)`, it is non-leaf and cannot be forked
- `.context(() => initialContext)` provides mutable resource-local state shared across lifecycle methods

Use the phases intentionally:

- `ready()` for listeners, schedulers, consumers, or other ingress
- `cooldown()` to stop admitting fresh work
- `dispose()` for final cleanup after in-flight work drains

Do not use `cooldown()` as a general teardown phase for support resources such as databases.

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

### Dynamic Registration

`.register()` accepts a function when the registered set depends on config.

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

Use function-based registration when:

- registered components depend on config
- you want one reusable template with environment-specific wiring
- you need to avoid registering optional components in every environment

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
- gateway resources cannot be forked

### Resource Exports and Isolation Boundaries

Use `.isolate({ exports: [...] })` to define a public surface for a resource subtree and keep everything else private.

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
  .build();
```

Semantics:

- No `isolate.exports` means everything remains public
- `exports: []` or `exports: "none"` makes the subtree private
- `exports` accepts explicit Runner definition or resource references only
- Visibility checks cover dependencies, hook `.on(...)`, tag attachments, and middleware attachment
- Exporting a child resource makes that child's own exported surface transitively visible
- Validation happens during `run(app)`, not declaration time
- Runtime operator APIs are gated only by the root resource's exported surface

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

Key rules:

- `deny` and `only` are mutually exclusive on the same resource
- `deny` and `only` accept definitions, `subtreeOf(...)`, or `scope(...)`
- `whitelist` uses `{ for: [...], targets: [...], channels? }`
- bare strings are invalid in `deny` and `only`
- enforcement covers dependencies, listening, tagging, and middleware channels
- parent and child isolation rules compose additively
- unknown targets fail fast at bootstrap

### Optional Dependencies

Mark dependencies as optional when a component may not be registered.

```typescript
import { r } from "@bluelibs/runner";

const analyticsService = r
  .resource("analyticsService")
  .init(async () => ({ track: (event: string) => console.log(event) }))
  .build();

const doWork = r
  .task("doWork")
  .dependencies({
    analytics: analyticsService.optional(),
  })
  .run(async (_input, { analytics }) => {
    analytics?.track("task.executed");
    return { done: true };
  })
  .build();
```

Optional dependencies work on tasks, resources, events, async contexts, and errors.

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
  .init(async (_config, _deps, ctx) => {
    const db = await connectToDatabase();
    ctx.connections.set("main", db);
    ctx.pools.push(createPool(db));
    return db;
  })
  .dispose(async (_db, _config, _deps, ctx) => {
    for (const pool of ctx.pools) {
      await pool.drain();
    }
  })
  .build();
```

> **runtime:** "Resources: I nurse them to life, let them work, then mercifully pull the plug in reverse order. It's a lot like IT support, except I actually follow the runbook."
