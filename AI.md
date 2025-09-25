# BlueLibs Runner: Fluent Builder Field Guide

> Token-friendly (<5000 tokens). This guide spotlights the fluent builder API (`r.*`) that ships with Runner 4.x. Classic `defineX` / `resource({...})` remain supported for backwards compatibility, but fluent builders are the default throughout.

## Table of Contents

- [BlueLibs Runner: Fluent Builder Field Guide](#bluelibs-runner-fluent-builder-field-guide)
  - [Table of Contents](#table-of-contents)
  - [Install](#install)
  - [Quick Start](#quick-start)
  - [Platform Matrix](#platform-matrix)
  - [Fluent Builder Primer](#fluent-builder-primer)
  - [Core Concepts](#core-concepts)
    - [Resources](#resources)
    - [Tasks](#tasks)
    - [Events and Hooks](#events-and-hooks)
    - [Middleware](#middleware)
    - [Tags](#tags)
    - [Async Context](#async-context)
    - [Errors](#errors)
  - [HTTP \& Tunnels](#http--tunnels)
  - [Serialization](#serialization)
  - [Testing](#testing)
  - [Observability \& Debugging](#observability--debugging)
  - [Advanced Patterns](#advanced-patterns)
  - [Interop With Classic APIs](#interop-with-classic-apis)

## Install

```bash
npm install @bluelibs/runner
```

Runner auto-detects its runtime. The Node bundle lives under `@bluelibs/runner/node`; browser helpers are under `@bluelibs/runner/platform`.

## Quick Start

```ts
import express from "express";
import { r, run, globals } from "@bluelibs/runner";
import { nodeExposure } from "@bluelibs/runner/node";

const server = r
  .resource<{ port: number }>("app.server")
  .context(() => ({ app: express() }))
  .init(async ({ port }, _deps, ctx) => {
    ctx.app.use(express.json());
    const listener = ctx.app.listen(port);
    return { ...ctx, listener };
  })
  .dispose(async ({ listener }) => listener.close())
  .build();

const createUser = r
  .task("app.tasks.createUser")
  .dependencies({ logger: globals.resources.logger })
  .inputSchema<{ name: string }>({ parse: (value) => value })
  .resultSchema<{ id: string; name: string }>({ parse: (value) => value })
  .run(async ({ input }, { logger }) => {
    await logger.info(`Creating user ${input.name}`);
    return { id: "user-1", name: input.name };
  })
  .build();

const api = r
  .resource("app.api")
  .register([
    server.with({ port: 3000 }),
    nodeExposure.with({
      http: { basePath: "/__runner", listen: { port: 3000 } },
    }),
    createUser,
  ])
  .dependencies({ server, createUser })
  .init(async (_config, { server, createUser }) => {
    server.listener.on("listening", () => {
      console.log("Runner HTTP server ready on port 3000");
    });

    server.app.post("/users", async (req, res) => {
      const user = await createUser(req.body);
      res.json(user);
    });
  })
  .build();

const runtime = await run(api);
await runtime.runTask(createUser, { name: "Ada" });
// runtime.dispose() when you are done.
```

- `r.*.with(config)` produces a configured copy of the definition.
- `run(root)` wires dependencies, runs `init`, emits lifecycle events, and returns helpers such as `runTask`, `getResourceValue`, and `dispose`.
- Enable verbose logging with `run(root, { debug: "verbose" })`.

## Platform Matrix

| Capability                                       | Node.js   | Browser      | Workers (e.g. Cloudflare) |
| ------------------------------------------------ | --------- | ------------ | ------------------------- |
| `run()` lifecycle                                | ✅        | ✅           | ✅                        |
| `nodeExposure`, Node tunnels                     | ✅        | ❌           | ❌                        |
| `createHttpClient`                               | ✅        | ✅           | ✅                        |
| Duplex upload (`createHttpSmartClient`)          | ✅        | ❌           | ❌                        |
| File helpers (`createNodeFile`, `createWebFile`) | Node only | Browser only | Browser only              |
| Async context (AsyncLocalStorage)                | ✅        | n/a          | n/a                       |

- Browser environments rely on `globalThis.__ENV__` or `globalThis.env` for configuration; Node uses `process.env`.
- Runner will throw if you call Node-only helpers in the browser; keep shared code inside `src/` and Node-specific logic under `src/node/`.

## Fluent Builder Primer

The fluent API lives under the single `r` namespace:

```ts
import { r } from "@bluelibs/runner";

const task = r
  .task("demo.tasks.hello")
  .run(async ({ input }) => input)
  .build();
```

Key rules:

- Builders are immutable; every fluent call returns a new builder with tightened typings.
- Call `.build()` once you finish configuring the definition.
- `with(config)` clones the built definition with typed config overrides.
- Use the same pattern across tasks, resources, hooks, middleware, and tags for consistent DX.

## Core Concepts

### Resources

Resources encapsulate long-lived values such as database connections or service facades.

```ts
import { MongoClient } from "mongodb";
import { r } from "@bluelibs/runner";

const database = r
  .resource<{ url: string }>("app.resources.database")
  .init(async ({ url }) => {
    const client = new MongoClient(url);
    await client.connect();
    return client;
  })
  .dispose(async (client) => client.close())
  .build();

const userService = r
  .resource("app.resources.userService")
  .dependencies({ database })
  .init(async (_config, { database }) => ({
    async create(user: { email: string }) {
      return database.db().collection("users").insertOne(user);
    },
  }))
  .build();
```

- `context(fn)` gives you a private object that survives `init` → `dispose`.
- `configSchema` and `resultSchema` accept anything with a `parse()` method (Zod, custom validators).
- Register resources inside other resources via `.register([...])`. Repeated calls append unless you pass `{ override: true }`.

### Tasks

Tasks are your business actions. They are plain async functions with DI, middleware, and validation.

```ts
import { r } from "@bluelibs/runner";

const sendEmail = r
  .task("app.tasks.sendEmail")
  .inputSchema<{ to: string; subject: string; body: string }>({
    parse: (value) => value,
  })
  .dependencies({ emailer: userService })
  .middleware((config) => [
    loggingMiddleware.with({ label: "email" }),
    tracingMiddleware,
  ])
  .run(async ({ input }, { emailer }) => {
    await emailer.send(input);
    return { delivered: true };
  })
  .build();
```

- `.dependencies()` accepts a literal map or a function `(config) => deps`.
- `.middleware()` appends by default; pass `{ override: true }` to replace. `.tags()` replaces the list each time.
- `.dependencies()` appends (shallow-merge) by default on resources, tasks, hooks, and middleware; pass `{ override: true }` to replace. Functions and objects are merged consistently.
- Provide result validation with `.resultSchema()` when the function returns structured data.

### Events and Hooks

Events are strongly typed signals. Hooks listen to them with predictable execution order.

```ts
import { r } from "@bluelibs/runner";

const userRegistered = r
  .event("app.events.userRegistered")
  .payloadSchema<{ userId: string; email: string }>({ parse: (v) => v })
  .build();

const registerUser = r
  .task("app.tasks.registerUser")
  .dependencies({ userRegistered, userService })
  .run(async ({ input }, deps) => {
    const user = await deps.userService.create(input);
    await deps.userRegistered.emit({ userId: user.id, email: user.email });
    return user;
  })
  .build();

const sendWelcomeEmail = r
  .hook("app.hooks.sendWelcomeEmail")
  .on(userRegistered)
  .dependencies({ mailer: sendEmail })
  .run(async (event, { mailer }) => {
    await mailer({ to: event.data.email, subject: "Welcome", body: "🎉" });
  })
  .build();
```

- Use `.on(onAnyOf(...))` to listen to several events while keeping inference.
- Hooks can set `.order(priority)`; lower numbers run first. Call `event.stopPropagation()` inside `run` to cancel downstream hooks.
- Wildcard hooks use `.on("*")` and receive every emission except events tagged with `globals.tags.excludeFromGlobalHooks`.

### Middleware

Middleware wraps tasks or resources. Fluent builders live under `r.middleware`.

```ts
import { r } from "@bluelibs/runner";
import { globals } from "@bluelibs/runner";

const auditTasks = r.middleware
  .task("app.middleware.audit")
  .dependencies({ logger: globals.resources.logger })
  .everywhere((task) => !task.id.startsWith("admin."))
  .run(async ({ task, next }, { logger }) => {
    logger.info(`→ ${task.definition.id}`);
    const result = await next(task.input);
    logger.info(`← ${task.definition.id}`);
    return result;
  })
  .build();

const cacheResources = r.middleware
  .resource("app.middleware.cache")
  .configSchema<{ ttl: number }>({ parse: (value) => value })
  .run(async ({ value, next }, _deps, config) => {
    if (value.current) {
      return value.current;
    }
    const computed = await next();
    value.current = computed;
    setTimeout(() => (value.current = null), config.ttl);
    return computed;
  })
  .build();
```

Attach middleware using `.middleware([auditTasks])` on the definition that owns it, and register the middleware alongside the target resource or task at the root.

### Tags

Tags let you annotate definitions with metadata that can be queried later.

```ts
import { r, globals } from "@bluelibs/runner";

const httpRouteTag = r
  .tag("app.tags.httpRoute")
  .configSchema<{ method: "GET" | "POST"; path: string }>({
    parse: (value) => value,
  })
  .build();

const getHealth = r
  .task("app.tasks.getHealth")
  .tags([httpRouteTag.with({ method: "GET", path: "/health" })])
  .run(async () => ({ status: "ok" }))
  .build();
```

Retrieve tagged items by using `globals.resources.store` inside a hook or resource and calling `store.getTasksWithTag(tag)`.

### Async Context

Async Context provides per-request/thread-local state via the platform's `AsyncLocalStorage` (Node). Use the fluent builder under `r.asyncContext` or the classic `asyncContext({ ... })` export.

```ts
import { r } from "@bluelibs/runner";

const requestContext = r
  .asyncContext<{ requestId: string }>("app.ctx.request")
  // below is optional
  .configSchema(z.object({ ... }))
  .serialize((data) => JSON.stringify(data))
  .parse((raw) => JSON.parse(raw))
  .build();

// Provide and read within an async boundary
await requestContext.provide({ requestId: "abc" }, async () => {
  const ctx = requestContext.use(); // { requestId: "abc" }
});

// Require middleware for tasks that need the context
const requireRequestContext = requestContext.require();
```

- If you don't provide `serialize`/`parse`, Runner uses its default EJSON serializer to preserve Dates, RegExp, etc.
- A legacy `createContext(name?)` exists for backwards compatibility; prefer `r.asyncContext` or `asyncContext({ id })`.

- You can also inject async contexts as dependencies; the injected value is the helper itself. Contexts must be registered to be used.

```ts
const whoAmI = r
  .task("app.tasks.whoAmI")
  .dependencies({ requestContext })
  .run(async (_input, { requestContext }) => requestContext.use().requestId)
  .build();

const app = r.resource("app").register([requestContext, whoAmI]).build();
```

### Errors

Define typed, namespaced errors with a fluent builder. Built helpers expose `throw`, `is`, and `toString`:

```ts
import { r } from "@bluelibs/runner";

// Fluent builder
const AppError = r
  .error<{ code: number; message: string }>("app.errors.AppError")
  .dataSchema(zod) // or { parse(obj) => obj }
  .build();

try {
  AppError.throw({ code: 400, message: "Oops" });
} catch (err) {
  if (AppError.is(err)) {
    // err.name === "app.errors.AppError", err.message === "Oops"
  }
}
```

- Error data must include a `message: string`. The thrown `Error` has `name = id` and `message = data.message` for predictable matching and logging.

## HTTP & Tunnels

Run Node exposures and connect to remote Runners with fluent resources.

```ts
import { r, globals } from "@bluelibs/runner";
import { nodeExposure } from "@bluelibs/runner/node";

const httpExposure = nodeExposure.with({
  http: {
    basePath: "/__runner",
    listen: { host: "0.0.0.0", port: 7070 },
    auth: { token: process.env.RUNNER_TOKEN },
  },
});

const tunnelClient = r
  .resource("app.tunnels.http")
  .tags([globals.tags.tunnel])
  .init(async () => ({
    mode: "client" as const,
    transport: "http" as const,
    tasks: (task) => task.id.startsWith("remote.tasks."),
    client: globals.tunnels.http.createClient({
      url: process.env.REMOTE_URL ?? "http://127.0.0.1:7070/__runner",
      auth: { token: process.env.RUNNER_TOKEN },
    }),
  }))
  .build();

const root = r
  .resource("app")
  .register([httpExposure, tunnelClient, getHealth])
  .build();
```

Use the unified HTTP client anywhere:

```ts
import { createHttpClient } from "@bluelibs/runner";
import { createFile as createWebFile } from "@bluelibs/runner/platform/createFile";

const client = createHttpClient({
  baseUrl: "/__runner",
  auth: { token: "secret" },
  serializer: JSON,
});

await client.task("app.tasks.getHealth");

const file = createWebFile({ name: "notes.txt" }, new Blob(["Hello"]));
await client.task("app.tasks.upload", { file });
```

- `createHttpSmartClient` (Node only) supports duplex streams.
- For Node-specific features such as `useExposureContext` for handling aborts and streaming in exposed tasks, see TUNNELS.md.
- Register authentication middleware or rate limiting on the exposure via middleware tags and filters.

## Serialization

Runner ships with an EJSON serializer that round-trips Dates, RegExp, binary, and custom shapes across Node and web.

```ts
import { r, globals } from "@bluelibs/runner";

const serializerSetup = r
  .resource("app.serialization")
  .dependencies({ serializer: globals.resources.serializer })
  .init(async (_config, { serializer }) => {
    class Distance {
      constructor(public value: number, public unit: string) {}
      typeName() {
        return "Distance";
      }
      toJSONValue() {
        return { value: this.value, unit: this.unit };
      }
    }

    serializer.addType(
      "Distance",
      (json) => new Distance(json.value, json.unit),
    );
  })
  .build();
```

Use `getDefaultSerializer()` when you need a standalone instance outside DI.

Note on files: The “File” you see in tunnels is not an EJSON custom type. Runner uses a dedicated $ejson: "File" sentinel in inputs which the tunnel client/server convert to multipart streams via a manifest. We intentionally do not call `EJSON.addType("File", ...)` by default, because file handling is performed by the tunnel layer (manifest hydration and multipart), not by the serializer. Keep using `createWebFile`/`createNodeFile` for uploads; use `EJSON.addType` only for your own domain types.

## Testing

- Use `npm run coverage:ai` to execute the full Jest suite in a token-friendly format. Focused tests can run via `npm run test -- task-name`.
- In unit tests, prefer running a minimal root resource and call `await run(root)` to get `runTask`, `emitEvent`, or `getResourceValue`.
- `createTestResource` is available for legacy suites but new code should compose fluent resources directly.

Example:

```ts
import { run } from "@bluelibs/runner";

test("sends welcome email", async () => {
  const app = r
    .resource("spec.app")
    .register([sendWelcomeEmail, registerUser])
    .build();
  const runtime = await run(app);
  await runtime.runTask(registerUser, { email: "user@example.com" });
  await runtime.dispose();
});
```

## Observability & Debugging

- Pass `{ debug: "verbose" }` to `run` for structured logs about registration, middleware, and lifecycle events.
- `globals.resources.logger` exposes the framework logger; register your own logger resource and override it at the root to capture logs centrally.
- Hooks and tasks emit metadata through `globals.resources.store`. Query it for dashboards or editor plugins.
- Use middleware for tracing (`r.middleware.task("...").run(...)`) to wrap every task call.

## Advanced Patterns

- **Optional dependencies:** mark dependencies as optional (`analytics: analyticsService.optional()`) so the builder injects `null` when the resource is absent.
- **Conditional registration:** `.register((config) => (config.enableFeature ? [featureResource] : []))`.
- **Async coordination:** `Semaphore` and `Queue` live in the main package.
- **Event safety:** Runner detects event emission cycles and throws an `EventCycleError` with the offending chain.

## Interop With Classic APIs

Existing code that uses `resource({ ... })`, `task({ ... })`, or `defineX` keeps working. You can gradually migrate:

```ts
import { r, resource as classicResource } from "@bluelibs/runner";

const classic = classicResource({ id: "legacy", init: async () => "ok" });
const modern = r.resource("modern").register([classic]).build();
```

Fluent builders produce the exact same runtime definitions, so you can mix both styles within one project.
