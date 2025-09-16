## Runner Fluent Builders (r.\*) — End-to-End Guide

This guide shows how to use the new fluent Builder API exposed via a single `r` namespace. Builders are ergonomic, type-safe, and compile to the same definitions used by Runner today, without runtime overhead or breaking changes.

### Import

```ts
import { r, run, resource, definitions } from "@bluelibs/runner";
```

You’ll primarily use `r`:

- `r.resource(id)`
- `r.task(id)`
- `r.event(id)`
- `r.hook(id)`
- `r.middleware.task(id)`
- `r.middleware.resource(id)`

Each builder provides a fluent chain to configure dependencies, schemas, middleware, tags, metadata, and implementation functions. Call `.build()` to produce a definition identical to `defineX`.

---

## Resources

Minimal:

```ts
const app = r
  .resource("app")
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
  .register([svc, loggingMw, tag])
  .dependencies({ svc })
  .tags([tag])
  .middleware([loggingMw])
  .context(() => ({ reqId: Math.random() }))
  .configSchema<{ feature: boolean }>({ parse: (x: any) => x })
  .resultSchema<{ status: string }>({ parse: (x: any) => x })
  .initObj(async ({ deps, ctx, config }) => {
    const sum = deps.svc.add(2, 3);
    return {
      status: `id=${ctx.reqId}; sum=${sum}; feature=${!!config?.feature}`,
    };
  })
  .build();
```

---

## Tasks

```ts
const adder = r
  .task("tasks.add")
  .inputSchema<{ a: number; b: number }>({ parse: (x: any) => x })
  .runObj(async ({ input }) => input!.a + input!.b)
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
- `init`/`run` have `initObj`/`runObj` helpers that expose `{ config, deps, ctx }` or `{ input, deps }` for ergonomic destructuring with full types.
- Tags and middleware must be registered; otherwise, sanity checks will fail at runtime. Builders keep tag and middleware types intact for compile-time checks.
- Schemas can be passed as plain objects with `parse` or libraries like `zod`—inference will flow accordingly.

For deeper contract tests, see `src/__tests__/typesafety.test.ts` and the builder tests under `src/__tests__/definers/`.

---

## Migration Notes

- Existing `defineX` APIs remain. Builders are sugar and compile to the same definitions.
- Import the single namespace `r` for all builders. You can still import `resource`, `task`, etc., to reference classic definitions or for mixing.
- No runtime overhead, no breaking changes. Builders are fully tree-shakeable.
