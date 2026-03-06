## Upgrading from 5.x to 6.0

This release removes and reshapes core APIs (`override` builders, middleware catch-all, Event Lanes helpers, event source contract), so treat it as a **major** upgrade.

Use this playbook in order. It is optimized for fast, low-risk migrations.

### 1. Pre-Flight Checklist

Before code changes:

- Pin your current app to the latest 5.x patch.
- Ensure your 5.x branch is green.
- Capture your current startup + shutdown logs for comparison.
- Identify usage of removed APIs:
  - `r.override.task/resource/hook/taskMiddleware/resourceMiddleware`
  - `middleware.everywhere`
  - `defineEventLanesTopology`, `toEventLanesResourceConfig`
  - `tags.eventLaneHook`
  - string event sources in low-level custom event emission code

### 2. Replace Legacy Override Builders

`r.override.*(...)` builder variants are removed.

Before:

```typescript
const mocked = r.override
  .task(realTask)
  .run(async () => "ok")
  .build();
```

After:

```typescript
const mocked = r.override(realTask, async () => "ok");
```

Migration rule:

- Task/hook/middleware: callback replaces `run`.
- Resource: callback replaces `init`.

### 2.1. Enforce Strict `.overrides([...])` Inputs

`.overrides([...])` now accepts only override-produced definitions (`r.override(...)` / `override(...)`), plus `null` / `undefined` for conditional lists.

Before (no longer valid):

```typescript
const mockMailer = r
  .resource("app.mailer")
  .init(async () => new MockMailer())
  .build();

r.resource("test").register([realMailer]).overrides([mockMailer]).build();
```

After:

```typescript
const mockMailer = r.override(realMailer, async () => new MockMailer());

r.resource("test").register([realMailer]).overrides([mockMailer]).build();
```

If you intended a second component (not replacement), use a different id. Leaf resources can still use `.fork("new-id")`; non-leaf resources should be composed explicitly.

### 2.2. Migrate Cache Customization to `cacheProvider`

Legacy 5.x cache factory task id is removed.
Use `resources.cacheProvider` as the extension seam (via cache config).

Before (5.x legacy):

```typescript
const redisCacheFactory = r
  .task("legacy.tasks.cacheFactory")
  .dependencies({ redis })
  .run(async (_options, { redis }) => new RedisCache(redis))
  .build();

const app = r
  .resource("app")
  .register([redis, resources.cache])
  .overrides([redisCacheFactory])
  .build();
```

After:

```typescript
const redisCacheProvider = r
  .resource("app.cacheProvider.redis")
  .dependencies({ redis })
  .init(
    async (_config, { redis }) =>
      async () =>
        new RedisCache(redis),
  )
  .build();

const app = r
  .resource("app")
  .register([redis, resources.cache.with({ provider: redisCacheProvider })])
  .build();
```

### 3. Remove `middleware.everywhere`

Self-declared global middleware is removed.

Before:

```typescript
const audit = r.middleware
  .task("app.middleware.audit")
  .run(async ({ task, next }) => next(task.input))
  .build();

const app = r.resource("app").register([audit]).build();
```

After (subtree-scoped):

```typescript
const app = r
  .resource("app")
  .subtree({
    tasks: { middleware: [audit] },
  })
  .register([audit])
  .build();
```

After (global catch-all interception):

```typescript
const app = r
  .resource("app")
  .dependencies({ taskRunner: resources.taskRunner })
  .init(async (_config, { taskRunner }) => {
    taskRunner.intercept(async (next, input) => next(input));
  })
  .build();
```

### 4. Migrate Event Source to Structured Objects

String sources are removed in low-level event APIs.

If your app emits via event dependencies, there is nothing to migrate here.
Only low-level/manual emissions need updates.

Allowed shape:

```typescript
{
  kind: "runtime" | "resource" | "task" | "hook" | "middleware";
  id: string;
}
```

### 5. Migrate Event Lanes APIs

Removed:

- `defineEventLanesTopology(...)`
- `toEventLanesResourceConfig(...)`
- `tags.eventLaneHook`

Use canonical config:

```typescript
const topology = r.eventLane.topology({
  profiles: { worker: { consume: [billingLane] } },
  bindings: [
    {
      lane: billingLane,
      queue,
      prefetch: 10,
      maxAttempts: 3,
      retryDelayMs: 250,
    },
  ],
});

eventLanesResource.with({
  profile: "worker",
  topology,
  mode: "network",
});
```

Binding-level retry config remains available for lane delivery retries (`maxAttempts`, `retryDelayMs`).

### 6. Move to Isolation-Based Public Surface

If you relied on implicit public runtime access, define exports explicitly.

Before:

```typescript
const app = r.resource("app").register([createInvoice]).build();
```

After:

```typescript
const app = r
  .resource("app")
  .isolate({ exports: [createInvoice] })
  .register([createInvoice])
  .build();
```

Runtime calls (`runTask`, `emitEvent`, `getResourceValue`, `getLazyResourceValue`) now fail fast with `runtimeAccessViolation` when target ids are not exported from the app boundary.

### 7. Respect Strict Builder Ordering

Builder chains are phase-locked. Reorder invalid chains.

Before:

```typescript
r.task("x")
  .run(async () => "ok")
  .dependencies({ db })
  .build();
```

After:

```typescript
r.task("x")
  .dependencies({ db })
  .run(async () => "ok")
  .build();
```

### 8. Treat Built Definitions as Immutable

`build()`, `.with()`, `.fork()`, and `.optional()` outputs are deeply frozen.

Before:

```typescript
const task = r
  .task("x")
  .run(async () => "ok")
  .build();
(task as any).meta = { title: "Changed at runtime" };
```

After:

- Build final shape up front (builder chain or `r.override(...)`).
- Do not mutate built definitions.

### 8.1 Optional: Adopt Transactional Events (New in v6)

Transactional behavior is new in v6 and opt-in (`.transactional()` on events).
There is no mandatory migration if you keep existing events non-transactional.

Standard event (valid, no migration needed):

```typescript
const orderPlaced = r.event("app.events.orderPlaced").build();
```

Transactional event (new behavior):

```typescript
const orderPlaced = r.event("app.events.orderPlaced").transactional().build();

r.hook("app.hooks.reserve")
  .on(orderPlaced)
  .run(async () => {
    // side effect
    return async () => {
      // undo side effect
    };
  })
  .build();
```

If you opt in, enforce:

- Every participating hook returns an async undo closure.
- `transactional + parallel` is invalid.
- `transactional + tags.eventLane` is invalid.

### 9. Switch Tag Discovery to Tag Dependencies

Deprecated:

- `store.getTasksWithTag()`
- `store.getResourcesWithTag()`

Preferred:

```typescript
const inspect = r
  .task("app.tasks.inspect")
  .dependencies({ routeTag })
  .run(async (_input, { routeTag }) =>
    routeTag.tasks.map((x) => x.definition.id),
  )
  .build();
```

### 10. Lifecycle Option Rename

`initMode` has been removed; use `lifecycleMode`.

Before:

```typescript
await run(app, { initMode: "parallel" });
```

After:

```typescript
await run(app, { lifecycleMode: "parallel" });
```

### 11. Adopt `cooldown()` for Ingress Resources

If your service accepts external work (HTTP, queues, gateways), add `cooldown()` to stop intake before drain:

```typescript
const server = r
  .resource("app.server")
  .init(async () => server)
  .cooldown(async (server) => {
    server.close();
  })
  .dispose(async (server) => {
    server.close();
  })
  .build();
```

### 12. Validate the Migration

Run the full suite after each migration batch:

```bash
npm run qa
```

Smoke test checklist:

- Runtime startup completes without subtree/isolation violations.
- Shutdown sequence emits `events.disposing` then `events.drained`.
- Task and event admissions are blocked during disposal as expected.
- Event Lanes consume only lanes for the active profile.
- Public runtime API calls succeed only for exported ids.

### 13. Suggested Rollout

- Phase 1: Upgrade dependencies and migrate compile-time breakages.
- Phase 2: Enable strict exports in non-production first and fix access violations.
- Phase 3: Validate shutdown behavior under load (drain budgets + cooldown).
- Phase 4: Promote to production with one runtime profile at a time for Event Lanes.

If your codebase has broad use of removed APIs, budget one focused migration iteration rather than mixing this with unrelated feature work.
