## Runner Fluent Builders (r.\*) — End-to-End Guide

This guide shows how to use the new fluent Builder API exposed via a single `r` namespace. Builders are ergonomic, type-safe, and compile to the same definitions used by Runner today, without runtime overhead or breaking changes.

### Import

```ts
import { r, run } from "@bluelibs/runner";
```

You’ll primarily use `r`:

- `r.resource(id)`
- `r.task(id)`
- `r.event(id)`
- `r.hook(id)`
- `r.tag(id)`
- `r.middleware.task(id)`
- `r.middleware.resource(id)`

Each builder provides a fluent chain to configure dependencies, schemas, middleware, tags, metadata, and implementation functions. Call `.build()` to produce a definition identical to `defineX`.

Quick rules of thumb:

- `.build()` materializes the definition; register only built items (task/resource/hook/middleware/tag), not builders.
- When a method accepts a list (for example, `.register()`, `.tags()`, `.middleware()`), you may pass a single item or an array.
- For resources, repeated `.register()` calls append by default; pass `{ override: true }` to replace.
- For resources and tasks, repeated `.middleware()` calls append by default; pass `{ override: true }` to replace.
- For resources, tasks, hooks, events, and middleware, repeated `.tags()` calls append by default; pass `{ override: true }` to replace.
- For resources, repeated `.overrides()` calls append by default; pass `{ override: true }` to replace.
- For resources, tasks, hooks and middleware, repeated `.dependencies()` calls append (shallow merge) by default; pass `{ override: true }` to replace. Mixed function/object deps are supported and merged consistently.

---

## Resources

Minimal:

```ts
// Optionally seed the resource config type at the entry point
type AppConfig = { feature?: boolean };
const app = r
  .resource<AppConfig>("app")
  .init(async () => "OK")
  .build();
```

With dependencies, tags, middleware, context and schemas:

```ts
const svc = resource({
  id: "svc",
  init: async () => ({ add: (a: number, b: number) => a + b }),
});

const tag = r.tag("my.tag").build();

const loggingMw = r.middleware
  .resource("mw.logging")
  .run(async ({ next }) => {
    const out = await next();
    return out;
  })
  .build();

const app = r
  .resource("app.composed")
  .register([svc, loggingMw, tag]) // single or array is OK
  .dependencies({ svc })
  .tags([tag])
  .middleware([loggingMw])
  .context(() => ({ reqId: Math.random() }))
  .configSchema<{ feature: boolean }>({ parse: (x: any) => x }) // or configSchema(zodObject)
  .resultSchema<{ status: string }>({ parse: (x: any) => x }) // or resultSchema(zodObject)
  .init(async ({ deps, ctx, config }) => {
    const sum = deps.svc.add(2, 3);
    return {
      status: `id=${ctx.reqId}; sum=${sum}; feature=${!!config?.feature}`,
    };
  })
  .build();

// Append vs override for register()
const r1 = r
  .resource("app.register.append")
  .register(svc) // append
  .register([loggingMw, tag]) // append
  .build();

const r2 = r
  .resource("app.register.override")
  .register([svc, tag])
  .register(loggingMw, { override: true }) // replace previous registrations
  .build();

// Dynamic register: compose functions and arrays
type Cfg = { flag: boolean };
const r3 = r
  .resource<Cfg>("app.register.dynamic")
  .register((cfg) => (cfg.flag ? [svc] : [])) // function
  .register(loggingMw) // array/single
  .build();
// r3.register is a function; r3.register({ flag: true }) => [svc, loggingMw]
```

---

## Tasks

```ts
const adder = r
  .task("tasks.add")
  .inputSchema<{ a: number; b: number }>({ parse: (x: any) => x })
  .run(async ({ input }) => input!.a + input!.b)
  .build();
```

With dependencies, tags, middleware, metadata, and result schema:

```ts
const tmw = r.middleware
  .task("tmw.wrap")
  .run(async ({ next }) => {
    const out = await next();
    return out;
  })
  .build();

const calc = r
  .task("tasks.calc")
  .dependencies({ adder })
  .tags([])
  .middleware([tmw])
  .resultSchema<number>({ parse: (x: any) => x })
  .meta({ title: "Calculator" } as any)
  .run(async (n: number, deps) => deps.adder({ a: n, b: 1 }))
  .build();
```

### Phantom Tasks

Create a no-op task that is intended to be routed through a tunnel (HTTP or custom). When run locally without a matching tunnel, it returns `undefined`. Use it to strongly type calls to remote services.

```ts
// Define a phantom task with typed input and resolved result
const remoteHello = r.task
  .phantom<{ name: string }, string>("app.tasks.remoteHello")
  .build();

// Register a tunnel that can execute it remotely
const tunnel = r
  .resource("app.tunnels.client")
  .tags([globals.tags.tunnel])
  .init(async () => ({
    mode: "client" as const,
    tasks: [remoteHello.id],
    run: async (task, input) => `Hello ${input.name}!`,
  }))
  .build();

const app = r.resource("app").register([remoteHello, tunnel]).build();
```

Notes:

- Builder exposes the same knobs as normal tasks: `.dependencies()`, `.middleware()`, `.tags()`, `.meta()`, `.inputSchema()`, `.resultSchema()`.
- The builder does not accept `.run()`; the runner injects a no-op function and brands the definition so tunnel middleware can intercept it.

---

## Events and Hooks

Events:

```ts
const userCreated = r
  .event("events.userCreated")
  .payloadSchema<{ id: string }>({ parse: (x: any) => x })
  .tags([])
  .meta({ title: "User Created" } as any)
  .build();
```

Hooks:

```ts
const listener = r
  .hook("hooks.audit")
  .on(userCreated)
  .order(10)
  .dependencies({})
  .tags([])
  .meta({ title: "Audit" } as any)
  .run(async (ev) => {
    // ev.id, ev.data.id
  })
  .build();
```

Register and emit via a resource:

```ts
const app = resource({ id: "events.app", register: [userCreated, listener] });
const rr = await run(app);
await rr.emitEvent(userCreated, { id: "u1" });
await rr.dispose();
```

---

## Middleware Builders

Task middleware:

```ts
const tmw = r.middleware
  .task("tmw.log")
  .dependencies({})
  .configSchema<{ level: "info" | "warn" | "error" }>({ parse: (x: any) => x })
  .tags([])
  .meta({ title: "TaskLogger" } as any)
  .everywhere(() => true)
  .run(async ({ next, task }, _deps, config) => {
    return next(task.input);
  })
  .build();
```

Resource middleware:

```ts
const rmw = r.middleware
  .resource("rmw.wrap")
  .dependencies({})
  .configSchema<{ ttl?: number }>({ parse: (x: any) => x })
  .tags([])
  .meta({ title: "ResourceWrapper" } as any)
  .everywhere(() => true)
  .run(async ({ next }) => next())
  .build();
```

Attach to resources or tasks via `.middleware([mw])` and ensure they’re registered in a parent resource.

Note on `.init()`:

- `.init` uses the classic `(config, deps, ctx)` signature; destructure inside the body when needed.
- If you skip seeding a config type, annotate the first argument in `init` and the builder will adopt that type.

Note on `.middleware()` and `.tags()`:

- You can pass a single item or an array.
- `.middleware()` and `.tags()` append by default; pass `{ override: true }` to replace the existing list.

Append vs override for `.middleware()` and `.overrides()`:

```ts
// Resource middleware append and override
const rmid = r.middleware
  .resource("mw.rid")
  .run(async ({ next }) => next())
  .build();
const app = r
  .resource("app.mw")
  .middleware([rmid]) // append
  .middleware([rmid], { override: true }) // replace
  .build();

// Task middleware append
const tmid = r.middleware
  .task("mw.tid")
  .run(async ({ next, task }) => next(task.input))
  .build();
const t = r
  .task("tasks.calc")
  .middleware([tmid]) // append
  .build();

// Resource overrides append and override
const res = r
  .resource("app.overrides")
  .overrides([someResource]) // append
  .overrides([anotherResource], { override: true }) // replace
  .build();

// Tags append and override
const tagA = r.tag("tag.A").build();
const tagB = r.tag("tag.B").build();
const tagged = r
  .task("app.tags")
  .tags([tagA]) // append
  .tags([tagB]) // append
  // .tags([tagB], { override: true }) // replace
  .build();
```

---

## Running

```ts
const app = r
  .resource("app")
  .register([])
  .init(async () => "OK")
  .build();
const rr = await run(app);
const value = rr.value; // "OK"
await rr.dispose();
```

Tasks from runtime:

```ts
const task = r
  .task("t")
  .run(async (n: number) => n + 1)
  .build();
const root = resource({ id: "root", register: [task] });
const rr = await run(root);
const result = await rr.runTask(task, 1); // 2
await rr.dispose();
```

---

## Type Safety Highlights

- Builder generics propagate across the chain: config, value/result, dependencies, context, meta, tags, and middleware are strongly typed.
- You can pre-seed a resource’s config type at the entry point: `r.resource<MyConfig>(id)` — this provides typed `config` for `.dependencies((config) => ...)` and `.register((config) => ...)` callables.
- Resource `.init` follows `(config, deps, ctx)`; task `.run` still supports the object-style helper `({ input, deps })` and will adopt the typed first parameter when you skip `.configSchema()`.
- Tags and middleware must be registered; otherwise, sanity checks will fail at runtime. Builders keep tag and middleware types intact for compile-time checks.
- Schemas can be passed as plain objects with `parse` or libraries like `zod`—inference will flow accordingly.

Cheat sheet:

- Resource `.register()` accepts item | item[] | (config) => item | item[]
  - Default = append; `{ override: true }` replaces prior registrations
- Tags and middleware accept single or array; repeated calls append by default; pass `{ override: true }` to replace
- Always call `.build()` and register built definitions

For deeper contract tests, see `src/__tests__/typesafety.test.ts` and the builder tests under `src/__tests__/definers/`.

---

## Migration Notes

- Existing `defineX` APIs remain. Builders are sugar and compile to the same definitions.
- Import the single namespace `r` for all builders. You can still import `resource`, `task`, etc., to reference classic definitions or for mixing.
- No runtime overhead, no breaking changes. Builders are fully tree-shakeable.
  Dependencies append examples:

```ts
// Resource deps: function + object merge
const app = r
  .resource("app.deps")
  .dependencies((cfg) => ({ svcA }))
  .dependencies({ svcB }) // merged with previous
  .build();

// Task deps: append and override
const t = r
  .task("tasks.t")
  .dependencies({ a })
  .dependencies({ b }) // append
  .dependencies({ c }, { override: true }) // replace with only c
  .build();

// Hook deps
const hk = r
  .hook("hooks.h")
  .on(ev)
  .dependencies({ a })
  .dependencies({ b })
  .build();
```
