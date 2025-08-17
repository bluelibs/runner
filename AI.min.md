# BlueLibs Runner: Minimal Guide

## Install

```bash
npm install @bluelibs/runner
```

## TL;DR

- Tasks: functions with DI and middleware
- Resources: managed singletons (init/dispose)
- Events: decoupled communication
- Hooks: lightweight event listeners
- Middleware: cross‑cutting concerns

## Quick Start

```ts
import express from "express";
import { resource, task, run } from "@bluelibs/runner";

const server = resource({
  id: "app.server",
  // shared between init, dispose
  context: () => ({ value: null }),
  init: async (config: { port: number }, dependencies, ctx) => {
    ctx.value = "some-value"; // If ever need to store extra values for correct dispose

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
  register: [server.with({ port: 3000 }), createUser],
  dependencies: { server, createUser },
  init: async (_, { server, createUser }) => {
    server.app.post("/users", async (req, res) =>
      res.json(await createUser(req.body))
    );
  },
});

// Run with optional debug/logs
await run(app.with({}), {
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
  meta: { tags: [globals.tags.excludeFromGlobalListeners] },
});
```

## Unhandled Errors

By default, unhandled errors are logged. You can customize this via `run({ onUnhandledError })`:

```ts
await run(app, {
  onUnhandledError: async ({ logger, error }) => {
    await logger.error("Unhandled error", { error });
    // Optional: also emit your own event or send to telemetry here
  },
});
```

If you prefer event-driven handling, you can still attach a hook to a custom event of your own.

## Debug (zero‑overhead when disabled)

Enable globally at run time:

```ts
await run(app, { debug: "verbose" });
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
    logger.onLog((log) => {
      // ship or transform
    });
  },
});
```

## Middleware (global or local)

```ts
import { middleware, resource, task } from "@bluelibs/runner";

// Config for middleware is specified here, or via configSchema
const auth = middleware<{ role: string }>({
  id: "app.middleware.auth",
  run: async ({ task, next }, _, cfg) => {
    if (task.input?.user?.role !== cfg.role) throw new Error("Unauthorized");
    return next(task.input);
  },
});

const adminOnly = task({
  id: "app.tasks.adminOnly",
  middleware: [auth.with({ role: "admin" })],
  run: async () => "secret",
});

const appWithGlobal = resource({
  id: "app",
  register: [auth.everywhere({ tasks: true, resources: false })],
  // you can also opt-in for filters: tasks(task) { return true; }
});
```

## Run Options (high‑level)

- debug: "normal" | "verbose" | DebugConfig
- logs: { printThreshold?: LogLevel | null; printStrategy?: "pretty" | "json" | "json-pretty"; bufferLogs?: boolean }
- errorBoundary: boolean (default true)
- shutdownHooks: boolean (default true)

Note: `globals` is a convenience object exposing framework internals:

- `globals.events` (ready, unhandledError, hookTriggered, hookCompleted, middlewareTriggered, middlewareCompleted)
- `globals.resources` (store, taskRunner, eventManager, logger, cache, queue)
- `globals.middlewares` (retry, cache, timeout, requireContext)
- `globals.tags` (system, debug, excludeFromGlobalListeners)

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

## Testing

```ts
import { createTestResource, run, override } from "@bluelibs/runner";

const app = resource({
  id: "app",
  register: [
    /* tasks/resources */
  ],
});
const harness = createTestResource(app, {
  overrides: [
    /* test overrides */
  ],
});

const { value: t, dispose } = await run(harness);
await t.runTask(someTask, { input: 1 });
await dispose();
```

## Metadata & Tags

```ts
import { tag, globals, task, resource } from "@bluelibs/runner";

// Simple tags and debug/system globals
const perf = tag<{ warnAboveMs: number }>({ id: "perf" });

const processPayment = task({
  id: "app.tasks.pay",
  meta: {
    title: "Process Payment",
    description: "Detailed",
    tags: ["billing", perf.with({ warnAboveMs: 1000 })],
  },
  run: async () => {
    /* ... */
  },
});

const internalSvc = resource({
  id: "app.resources.internal",
  meta: { tags: [globals.tags.system] },
  init: async () => ({}),
});
```

### Tag Contracts (type‑enforced returns)

```ts
// Contract enforces the awaited return type
const userContract = tag<void, { name: string }>({ id: "contract.user" });

const getProfile = task({
  id: "app.tasks.getProfile",
  meta: { tags: [userContract] },
  run: async () => ({ name: "Ada" }), // must contain { name: string }
});

const profileService = resource({
  id: "app.resources.profile",
  meta: { tags: [userContract] },
  init: async () => ({ name: "Ada" }),
});
```

### Tag Extraction (behavior flags)

```ts
const perf = tag<{ warnAboveMs: number }>({ id: "perf" });

const perfMiddleware = middleware({
  id: "app.middleware.perf",
  run: async ({ task, next }) => {
    const cfg = perf.extract(task.definition); // or perf.extract(task.definition.meta?.tags)
    if (!cfg) return next(task.input);
    // performance hooks
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

## Bonus

- Optional dependencies: `dependencies: { analytics: analyticsService.optional() }`
- Stop propagation: inside hooks `event.stopPropagation()`
- All components require an explicit `id`

That’s it. Small surface area, strong primitives, great DX.

## Concurrency: Semaphore & Queue

```ts
import { Semaphore, Queue } from "@bluelibs/runner";

// Semaphore: limit parallelism
const dbSem = new Semaphore(5);
const users = await dbSem.withPermit(async () =>
  db.query("SELECT * FROM users")
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
