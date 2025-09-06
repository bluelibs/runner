# BlueLibs Runner: Minimal Guide

## Install

```bash
npm install @bluelibs/runner
```

## Platform & Browser

- Auto‑detects platform at runtime. In browsers, `exit()` is unsupported and throws. Env reads use `globalThis.__ENV__`, `process.env`, or `globalThis.env`.

```ts
import { setPlatform, BrowserPlatformAdapter } from "@bluelibs/runner/platform";
setPlatform(new BrowserPlatformAdapter());
//
globalThis.__ENV__ = { API_URL: "https://example.test" };
```

## Core Philosophy

BlueLibs Runner is a **powerful and integrated** framework. It provides a comprehensive set of tools for building robust, testable, and maintainable applications by combining a predictable Dependency Injection (DI) container with a dynamic metadata and eventing system.

## DI Container Guarantees

This is the foundation of trust for any DI framework.

- **Circular Dependencies**: A runtime circular dependency (e.g., `A → B → A`) is a fatal error. The runner **will fail to start** and will throw a descriptive error showing the full dependency chain, forcing you to fix the architecture.
- **Override Precedence**: Overrides are applied top-down. In case of conflicting overrides for the same `id`, the one defined closest to the root `run()` call wins. The "root is the boss."

## TL;DR

- **Lifecycle**: `run() → init resources (deps first) → 'ready' event → dispose() (reverse order)`
- **Tasks**: Functions with DI and middleware. Flow: `call → middleware → input validation → run() → result validation → return`
- **Resources**: Managed singletons (init/dispose).
- **Events**: Decoupled communication. Flow: `emit → validation → find & order hooks → run hooks (stoppable)`
- **Hooks**: Lightweight event listeners. Async and awaited by default.
- **Middleware**: Cross-cutting concerns. Async and awaited by default. Optionally contract-enforcing for input/output.
- **Tags**: Metadata for organizing, filtering, enforcing input/output contracts to tasks or resources.

## Quick Start

```ts
import express from "express";
import { resource, task, run } from "@bluelibs/runner";

const server = resource({
  id: "app.server",
  // "context" is for private state between init() and dispose()
  context: () => ({ value: null }),
  init: async (config: { port: number }, dependencies, ctx) => {
    ctx.value = "some-value"; // Store private state for dispose()

    const app = express();
    const server = app.listen(config.port);
    return { app, server };
  },
  dispose: async ({ server }, config, deps, ctx) => server.close(),
});

const createUser = task({
  id: "app.tasks.createUser",
  dependencies: { server },
  run: async (user: { name: string }, deps) => ({ id: "u1", ...user }),
});

const app = resource({
  id: "app",
  // Resources with configurations must be registered with with() unless the configuration allows all optional
  // All elements must be registered for them to be used in the system
  register: [server.with({ port: 3000 }), createUser],
  dependencies: { server, createUser },
  init: async (_, { server, createUser }) => {
    server.app.post("/users", async (req, res) =>
      res.json(await createUser(req.body)),
    );
  },
});

// Run with optional debug/logs
// If app had a config app.with(config) for 1st arg
await run(app, {
  debug: "normal", // "normal" | "verbose" | DebugConfig
  logs: { printThreshold: "info", printStrategy: "pretty" },
});
```

## Events & Hooks

```ts
import { event, hook, globals } from "@bluelibs/runner";

const userRegistered = event<{ userId: string; email: string }>({
  id: "app.events.userRegistered",
});

const sendWelcome = hook({
  id: "app.hooks.sendWelcome",
  on: userRegistered,
  run: async (e) => console.log(`Welcome ${e.data.email}`),
});

// Wildcard listener
const audit = hook({
  id: "app.hooks.audit",
  on: "*",
  run: (e) => console.log(e.id),
});

// Exclude internal events from "*"
const internal = event({
  id: "app.events.internal",
  tags: [globals.tags.excludeFromGlobalHooks],
});

// Performance: runtime event emission cycle detection
// run(app, { runtimeCycleDetection: true }) // To prevent deadlocks from happening.
```

### Multiple Events per Hook

Listen to multiple events with type-safe common fields:

```ts
const h = hook({
  id: "app.hooks.multi",
  on: [event1, event2, event3],
  run: async (ev) => {
    // helper utility
    if (isOneOf(ev, [event1, event2])) {
      // all common fields from event1 and event2, if just event1, it will be just event1
    }
  },
});
```

### Interception APIs

Low-level interception is available for advanced observability and control:

- `eventManager.intercept((next, event) => Promise<void>)` — wraps event emission
- `eventManager.interceptHook((next, hook, event) => Promise<any>)` — wraps hook execution
- `middlewareManager.intercept("task" | "resource", (next, input) => Promise<any>)` — wraps middleware execution
- `middlewareManager.interceptMiddleware(middleware, interceptor)` — per-middleware interception

Prefer task-level `task.intercept()` for application logic; use the above for cross-cutting concerns.

## Unhandled Errors

By default, unhandled errors are just logged. You can customize this via `run(app, { onUnhandledError })`:

```ts
await run(app, {
  errorBoundary: true, // Catch process-level errors (default: true)
  onUnhandledError: async ({ error, kind, source }) => {
    // kind: "task" | "middleware" | "resourceInit" | "hook" | "process" | "run"
    // source: optional origin hint (ex: "uncaughtException")
    await telemetry.capture(error as Error, { kind, source });

    // Optionally decide on remediation strategy
    if (kind === "process") {
      // For hard process faults, prefer fast, clean exit after flushing logs
      await flushAll();
      process.exit(1);
    }
  },
});
```

If you prefer event-driven handling, you can still emit your own custom events from this callback.

## Debug (zero‑overhead when disabled)

Enable globally at run time:

```ts
await run(app, { debug: "verbose" }); // "normal" or DebugConfig
```

or per‑component via tag:

```ts
import { globals, task } from "@bluelibs/runner";

const critical = task({
  id: "app.tasks.critical",
  meta: {
    tags: [
      globals.tags.debug.with({ logTaskInput: true, logTaskResult: true }),
    ],
  },
  run: async () => "ok",
});
```

## Logger (direct API)

```ts
import { resource, globals } from "@bluelibs/runner";

const logsExtension = resource({
  id: "app.logs",
  dependencies: { logger: globals.resources.logger },
  init: async (_, { logger }) => {
    logger.info("test", { data }); // "trace", "debug", "info", "warn", "error", "critical"
    const sublogger = logger.with({
      source: "app.logs",
      context: {},
    });
    logger.onLog((log) => {
      // ship or transform
    });
  },
});
```

## Middleware (global or local)

Middleware now supports type contracts with `<Config, Input, Output>` signature:

```ts
import {
  taskMiddleware,
  resourceMiddleware,
  resource,
  task,
  globals,
} from "@bluelibs/runner";

// Custom task middleware with type contracts
const auth = taskMiddleware<
  { role: string },
  { user: { role: string } },
  { user: { role: string; verified: boolean } }
>({
  id: "app.middleware.auth",
  run: async ({ task, next }, _, cfg) => {
    if (task.input?.user?.role !== cfg.role) throw new Error("Unauthorized");
    const result = await next(task.input);
    return { user: { ...task.input.user, verified: true } };
  },
});

// Resource middleware can augment a resource's behavior after it's initialized.
// For example, this `softDelete` middleware intercepts the `delete` method
// of a resource and replaces it with a non-destructive update.
const softDelete = resourceMiddleware({
  id: "app.middleware.softDelete",
  run: async ({ resource, next }) => {
    const resourceInstance = await next(resource.config); // The original resource instance

    // This example assumes the resource has `update` and `delete` methods.
    // A more robust implementation would check for their existence.

    // Monkey-patch the 'delete' method
    const originalDelete = resourceInstance.delete;
    resourceInstance.delete = async (id: string, ...args) => {
      // Instead of deleting, call 'update' to mark as deleted
      return resourceInstance.update(id, { deletedAt: new Date() }, ...args);
    };

    return resourceInstance;
  },
});

const adminOnly = task({
  id: "app.tasks.adminOnly",
  middleware: [auth.with({ role: "admin" })],
  run: async () => "secret",
});

// Built-in middleware patterns
const {
  task: { retry, timeout, cache },
  // available: resource: { retry, timeout, cache } as well, same configs.
} = globals.middleware;

// Example of custom middleware with full type contracts
const validationMiddleware = taskMiddleware<
  { strict: boolean },
  { data: unknown },
  { data: any; validated: boolean }
>({
  id: "app.middleware.validation",
  run: async ({ task, next }, _, config) => {
    // Validation logic here
    const result = await next(task.input);
    return { ...result, validated: true };
  },
});

const resilientTask = task({
  id: "app.tasks.resilient",
  middleware: [
    // Retry with exponential backoff, allow each with timeout
    retry.with({
      retries: 3,
      delayStrategy: (attempt) => 1000 * attempt,
      stopRetryIf: (error) => error.message === "Invalid credentials",
    }),
    // Timeout protection (propose-timeout)
    timeout.with({ ttl: 10000 }),
    // Caching first (onion-level)
    cache.with({
      ttl: 60000,
      keyBuilder: (taskId, input) => `${taskId}-${JSON.stringify(input)}`,
    }),
  ],
  run: async () => expensiveApiCall(),
});

// Global middleware
const globalTaskMiddleware = taskMiddleware({
  id: "...",
  everywhere: true, // Use everywhere: (task) => boolean, where true means it gets applied
  // ... rest as usual ...
  // if you have dependencies as task, exclude them via everywhere filter.
});

// Global resource middleware (same everywhere semantics)
const globalResourceMiddleware = resourceMiddleware({
  id: "...",
  everywhere: true, // or: (resource) => boolean
  run: async ({ next }) => next(),
});
```

## Context (request-scoped values)

```ts
import { createContext } from "@bluelibs/runner";

const UserCtx = createContext<{ userId: string }>("app.userContext");

// In middleware or entry-point
UserCtx.provide({ userId: "u1" }, async () => {
  await someTask(); // has access to the context
});

// In a task or hook
const user = UserCtx.use(); // -> { userId: "u1" }

// In a task definition
const task = {
  middleware: [UserCtx.require()], // This middleware works only in tasks.
};
```

## System Shutdown & Error Boundary

The framework includes built-in support for graceful shutdowns:

```ts
const { dispose } = await run(app, {
  shutdownHooks: true, // Automatically handle SIGTERM/SIGINT (default: true)
  errorBoundary: true, // Catch unhandled errors and rejections (default: true)
});
```

## Run Options (high‑level)

- debug: "normal" | "verbose" | DebugConfig
- logs: {
  - printThreshold?: LogLevel | null;
  - printStrategy?: "pretty" | "json" | "json-pretty" | "plain";
  - bufferLogs?: boolean
- }
- errorBoundary: boolean (default true)
- shutdownHooks: boolean (default true)
- onUnhandledError(error) {}

Note: `globals` is a convenience object exposing framework internals:

- `globals.events` (ready)
- `globals.resources` (store, taskRunner, eventManager, logger, cache, queue)
- `globals.middleware` (retry, cache, timeout, requireContext)
- `globals.tags` (system, debug, excludeFromGlobalHooks)

## Overrides

```ts
import { override, resource } from "@bluelibs/runner";

const emailer = resource({ id: "app.emailer", init: async () => new SMTP() });
const testEmailer = override(emailer, { init: async () => new MockSMTP() });

const app = resource({
  id: "app",
  register: [emailer],
  overrides: [testEmailer],
});
```

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

## Factory Pattern

Use a resource to act as a factory for creating class instances. The resource is configured once, and the resulting function can be used throughout the app.

```ts
const myFactory = resource({
  id: "app.factories.myFactory",
  init: async (config: SomeConfigType) => {
    // The resource's value is a factory function
    return (input: any) => {
      return new MyClass(input, config.someOption);
    };
  },
});

const app = resource({
  id: "app",
  register: [myFactory.with({ someOption: "configured" })],
  dependencies: { myFactory },
  init: async (_, { myFactory }) => {
    const instance = myFactory({ someInput: "hello" });
  },
});
```

## Testing

```ts
import { resource, run, override } from "@bluelibs/runner";

const app = resource({
  id: "app",
  register: [
    /* tasks/resources */
  ],
});
const harness = resource({
  id: "test",
  register: [app],
  overrides: [
    /* test overrides */
  ],
});

const rr = await run(harness);
await rr.runTask(id | task, { input: 1 });
// rr.getResourceValue(id | resource)
// await rr.emitEvent(event, payload)
// rr.logger.info("xxx")
await rr.dispose();
```

## Pre‑release (alpha)

Publish an alpha without affecting latest:

```bash
npm version prerelease --preid=alpha
npm run clean && npm run build
npm publish --tag alpha --access public
# consumers: npm i @bluelibs/runner@alpha
```

Local test without publishing:

```bash
npm pack  # then in a demo app: npm i ../@bluelibs-runner-<version>.tgz
# or: npm link / npm link @bluelibs/runner
```

Coverage tip: the script name is `npm run coverage`.

## Metadata & Tags

```ts
import { tag, globals, task, resource } from "@bluelibs/runner";

// Simple tags and debug/system globals
const perf = tag<{ warnAboveMs: number }>({ id: "perf" });
const contractTag = tag<void, void, { result: string }>({ id: "contract" });

const processPayment = task({
  id: "app.tasks.pay",
  tags: [perf.with({ warnAboveMs: 1000 })],
  meta: {
    title: "Process Payment",
    description: "Detailed",
  },
  run: async () => {
    /* ... */
  },
});

const internalSvc = resource({
  id: "app.resources.internal",
  register: [perf],
  tags: [globals.tags.system],
  init: async () => ({}),
});
```

### Tag Contracts (type‑enforced returns)

```ts
// Contract enforces the awaited return type (Config, Input, Output)
const userContract = tag<void, void, { name: string }>({ id: "contract.user" });

const getProfile = task({
  id: "app.tasks.getProfile",
  tags: [userContract],
  run: async () => ({ name: "Ada" }), // must contain { name: string }
});

const profileService = resource({
  id: "app.resources.profile",
  tags: [userContract],
  init: async () => ({ name: "Ada" }),
});
```

### Tag Extraction (behavior flags)

```ts
const perf = tag<{ warnAboveMs: number }>({ id: "perf" });

const perfMiddleware = taskMiddleware({
  id: "app.middleware.perf",
  run: async ({ task, next }) => {
    const cfg = perf.extract(task.definition);
    // use perf.exists(task.definition) to check for existence
    if (!cfg) return next(task.input);
    // performance hooks here ...
  },
});
```

### Intercept Tasks via Tags (programmatic wiring)

Use a hook on `globals.events.ready` to discover and intercept tasks by tag:

```ts
import { hook, globals, tag } from "@bluelibs/runner";

const apiTag = tag<void>({ id: "api" });

const addTracingToApiTasks = hook({
  id: "app.hooks.traceApis",
  on: globals.events.ready,
  dependencies: { store: globals.resources.store },
  run: async (_, { store }) => {
    const apiTasks = store.getTasksWithTag(apiTag); // tag object or string id
    apiTasks.forEach((taskDef) => {
      taskDef.intercept(async (next, input) => {
        // ...
      });
    });
    // Apply same concept to routing like fastify, express routes based on tag config to your fastify instance.
  },
});
```

### Route registration via tags (ready hook)

```ts
import { hook, globals } from "@bluelibs/runner";
import { httpTag } from "./http.tag"; // your structured tag (method, path, schemas, etc.)
import { expressServer } from "./expressServer"; // resource that returns { app, port }

const registerRoutes = hook({
  id: "app.hooks.registerRoutes",
  on: globals.events.ready,
  dependencies: { store: globals.resources.store, server: expressServer },
  run: async (_, { store, server }) => {
    const tasks = store.getTasksWithTag(httpTag);
    tasks.forEach((t) => {
      const cfg = httpTag.extract(t.meta?.tags || []);
      if (!cfg?.config) return;
      const { method, path } = cfg.config;
      if (!method || !path) return;
      (server.app as any)[method.toLowerCase()](path, async (req, res) => {
        const result = await t({ ...req.body, ...req.query, ...req.params });
        res.json(result);
      });
    });
  },
});
```

## Key Patterns & Features

- **Optional Dependencies**: Gracefully handle missing services by defining dependencies as optional. The dependency will be `null` if not registered.
  `dependencies: { analytics: analyticsService.optional() }`

- **Stop Propagation**: Prevent other hooks from running for a specific event.
  `// inside a hook`
  `event.stopPropagation()`

That’s it. Small surface area, strong primitives, great DX.

## Concurrency: Semaphore & Queue

```ts
import { Semaphore, Queue } from "@bluelibs/runner";

// Semaphore: limit parallelism
const dbSem = new Semaphore(5);
const users = await dbSem.withPermit(async () =>
  db.query("SELECT * FROM users"),
);

// Queue: FIFO with cooperative cancellation
const queue = new Queue();
const result = await queue.run(async (signal) => {
  signal.throwIfAborted();
  return await doWork();
});
await queue.dispose({ cancel: true });
```

## Handling Circular Types (even if runtime is fine)

Rarely, when TypeScript struggles with circular type inference, break the chain with an explicit interface:

```ts
import type { IResource } from "@bluelibs/runner";

export const cResource = resource({
  id: "c.resource",
  dependencies: { a: aResource },
  init: async (_, { a }) => `C depends on ${a}`,
}) as IResource<void, string>; // void config, returns string
```

## Validation (optional and library‑agnostic)

## Event Cycle Safety

To prevent event‑driven deadlocks, the runner detects cycles during emission:

- A cycle occurs when an event emits another event that eventually re‑emits the original event within the same emission chain (for example: `e1 -> e2 -> e1`).
- When a cycle is detected, an `EventCycleError` is thrown with a readable chain to help debugging.
- A hook re‑emitting the same event it currently handles is allowed only when the emission originates from the same hook instance (useful for idempotent/no‑op retries); other cases are blocked.

Guidance:

- Prefer one‑way flows; avoid mutual cross‑emits between hooks.
- Use `event.stopPropagation()` to short‑circuit handlers when appropriate.
- Use tags (for example, `globals.tags.excludeFromGlobalHooks`) to scope listeners and avoid unintended re‑entry via global hooks.

Interface any library can implement:

```ts
interface IValidationSchema<T> {
  parse(input: unknown): T;
}
```

Works out of the box with Zod (`z.object(...).parse`), and can be adapted for Yup/Joi with small wrappers.

```ts
import { z } from "zod";

// Task input/result validation
const inputSchema = z.object({ email: z.string().email() });
const resultSchema = z.object({ id: z.string(), email: z.string().email() });

task({
  // ...
  inputSchema, // validates before run
  resultSchema, // validates awaited return
});

resource({
  configSchema, // Resource config validation (runs on .with())
  resultSchema, // Runs after initialization
});

event({
  payloadSchema, // Runs on event emission
});

// Middleware config validation (runs on .with())
middleware({
  // ...
  configSchema, // runs on .with()
});
```
