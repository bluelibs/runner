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
  - `globals.tags.eventLaneHook`
  - string event sources in custom `eventManager.emit(...)` usage

### 2. Replace Legacy Override Builders

`r.override.*(...)` builder variants are removed.

Before:

```typescript
const mocked = r.override.task(realTask).run(async () => "ok").build();
```

After:

```typescript
const mocked = r.override(realTask, async () => "ok");
```

Migration rule:

- Task/hook/middleware: callback replaces `run`.
- Resource: callback replaces `init`.

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
  .dependencies({ taskRunner: globals.resources.taskRunner })
  .init(async (_config, { taskRunner }) => {
    taskRunner.intercept(async (next, input) => next(input));
  })
  .build();
```

### 4. Migrate Event Source to Structured Objects

String sources are removed in low-level event APIs.

Before:

```typescript
await eventManager.emit(orderCreated, payload, "http");
```

After:

```typescript
import { runtimeSource } from "@bluelibs/runner";

await eventManager.emit(orderCreated, payload, runtimeSource.runtime("http"));
```

Allowed shape:

```typescript
{ kind: "runtime" | "resource" | "task" | "hook" | "middleware"; id: string }
```

### 5. Migrate Event Lanes APIs

Removed:

- `defineEventLanesTopology(...)`
- `toEventLanesResourceConfig(...)`
- `globals.tags.eventLaneHook`
- lane retry config (`retry.maxAttempts`) on bindings

Use canonical config:

```typescript
const topology = r.eventLane.topology({
  profiles: { worker: { consume: [billingLane] } },
  bindings: [{ lane: billingLane, queue, prefetch: 10 }],
});

eventLanesResource.with({
  profile: "worker",
  topology,
  mode: "consumer",
});
```

Retry policy now belongs in business middleware (task/resource middleware), not transport config.

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

Runtime calls (`runTask`, `emitEvent`, `getResourceValue`, `getLazyResourceValue`) now fail fast with `runtimeAccessViolation` when target ids are not exported from the root boundary.

### 7. Respect Strict Builder Ordering

Builder chains are phase-locked. Reorder invalid chains.

Before:

```typescript
r.task("x").run(async () => "ok").dependencies({ db }).build();
```

After:

```typescript
r.task("x").dependencies({ db }).run(async () => "ok").build();
```

### 8. Treat Built Definitions as Immutable

`build()`, `.with()`, `.fork()`, and `.optional()` outputs are deeply frozen.

Before:

```typescript
const task = r.task("x").run(async () => "ok").build();
(task as any).meta = { title: "Changed at runtime" };
```

After:

- Build final shape up front (builder chain or `r.override(...)`).
- Do not mutate built definitions.

### 9. Switch Tag Discovery to Tag Dependencies

Deprecated:

- `store.getTasksWithTag()`
- `store.getResourcesWithTag()`

Preferred:

```typescript
const inspect = r
  .task("app.tasks.inspect")
  .dependencies({ routeTag })
  .run(async (_input, { routeTag }) => routeTag.tasks.map((x) => x.definition.id))
  .build();
```

### 10. Lifecycle Option Rename

`initMode` is deprecated alias; use `lifecycleMode`.

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
  .init(async () => listener)
  .cooldown(async (listener) => {
    listener.close();
  })
  .dispose(async (listener) => {
    listener.close();
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
- Shutdown sequence emits `globals.events.disposing` then `globals.events.drained`.
- Task and event admissions are blocked during disposal as expected.
- Event Lanes consume only lanes for the active profile.
- Public runtime API calls succeed only for exported ids.

### 13. Suggested Rollout

- Phase 1: Upgrade dependencies and migrate compile-time breakages.
- Phase 2: Enable strict exports in non-production first and fix access violations.
- Phase 3: Validate shutdown behavior under load (drain budgets + cooldown).
- Phase 4: Promote to production with one runtime profile at a time for Event Lanes.

If your codebase has broad use of removed APIs, budget one focused migration iteration rather than mixing this with unrelated feature work.
