## Multi-Tenant Systems

Multi-tenant work in Runner usually means one `run(app)` serving many tenants without mixing their logical state.
Runner's identity-aware middleware (`cache`, `rateLimit`, `debounce`, `throttle`, and `concurrency`) reads tenant partitioning data from an async context grouper.

- If you do nothing, Runner uses the built-in `asyncContexts.identity`.
- If your app needs extra runtime-validated fields such as `userId`, define your own async context, register it, and pass it to `run(app, { identity })`.

### Built-In Default

Use `asyncContexts.identity` when the built-in identity shape is enough, for example `{ tenantId, userId? }`.

```typescript
import { asyncContexts, middleware, r, run } from "@bluelibs/runner";

const { identity } = asyncContexts;

const projectRepo = r
  .resource("projectRepo")
  .init(async () => {
    const storage = new Map<string, string[]>();

    return {
      async list() {
        const { tenantId } = identity.use();
        return storage.get(tenantId) ?? [];
      },
    };
  })
  .build();

const listProjects = r
  .task("listProjects")
  .middleware([identity.require(), middleware.task.cache.with({ ttl: 30_000 })])
  .dependencies({ projectRepo })
  .run(async (_input, { projectRepo }) => projectRepo.list())
  .build();

const app = r.resource("app").register([projectRepo, listProjects]).build();
const runtime = await run(app);

await identity.provide({ tenantId: "acme" }, () =>
  runtime.runTask(listProjects),
);
```

This keeps tenant identity in async context instead of global mutable state.
The flow is: ingress provides the identity, identity-sensitive tasks require it, downstream code reads it, and identity-aware middleware partitions internal keys with `<tenantId>:` when identity context exists.
That same identity value also remains visible to nested `run()` calls created inside the same async execution tree, which is uncommon but useful when one runtime intentionally orchestrates another without dropping identity awareness.

### Custom Identity Context

Use a custom async context when identity-aware framework behavior should follow a richer contract such as `{ tenantId, userId }`.

```typescript
import { middleware, r, run } from "@bluelibs/runner";

const identity = r
  .asyncContext("appTenant")
  .configSchema({
    tenantId: String,
    userId: String,
    locale: String,
  })
  .build();

const listProjects = r
  .task("listProjects")
  .middleware([
    identity.require(),
    middleware.task.cache.with({ ttl: 30_000, identityScope: "required" }),
  ])
  .run(async () => {
    const { tenantId, userId } = identity.use();
    return { tenantId, userId };
  })
  .build();

const app = r.resource("app").register([identity, listProjects]).build();
const runtime = await run(app, { identity });

await identity.provide({ tenantId: "acme", userId: "u1" }, () =>
  runtime.runTask(listProjects),
);
```

Why this pattern matters:

- your app keeps using its own context directly for `provide()`, `use()`, and `require()`
- Runner internals read that same context for identity-aware middleware behavior
- `.configSchema(...)` validates your richer ingress contract before `provide(...)` binds it

If that custom identity context is already registered in the app graph, your app can also depend on it directly in the usual way.
If it is not registered, `run(app, { identity })` still auto-registers it for runtime dependency usage.
Transport features remain stricter: HTTP clients, exposure, and remote lanes can only serialize or hydrate contexts that are registered and explicitly forwarded.

### Access Patterns

Use identity access in two modes:

- strict: `identity.use()` when running without an identity would be a correctness bug
- safe: `identity.tryUse()` or `identity.has()` in shared helpers that may execute outside identity-bound work
- `identity.require()` only enforces that an identity value exists. With the built-in `asyncContexts.identity`, that means tenant identity is present, not that `userId` exists too. Prefer your own authorization middleware when access rules depend on the active user. If you still want user presence enforced at identity binding time, make `userId` required in your custom identity context schema and pass that context to `run(..., { identity })`.

```typescript
import { asyncContexts } from "@bluelibs/runner";

const { identity } = asyncContexts;

export function getTelemetryTenantId(): string | undefined {
  return identity.tryUse()?.tenantId;
}
```

### Identity Scope

Identity-aware middleware defaults to `identityScope: "auto"`.
That means `cache`, `rateLimit`, `debounce`, `throttle`, and `concurrency` prefix their internal keys with `tenantId` when identity context exists, and fall back to the shared non-tenant keyspace when it does not.

- Use `identity.provide({ tenantId }, fn)` at HTTP, RPC, queue, or job ingress.
- Use `identity.require()` or `identity.use()` when running without an identity would be a correctness bug.
- `identity.require()` does not validate optional fields such as `userId` on the built-in identity context. Prefer your own authorization middleware when access rules depend on the active user, or use a custom identity context when you want `userId` required as part of the identity contract itself.
- Omit `identityScope` for the default `"auto"` behavior.
- Use `identityScope: "auto"` when you want to make that default explicit in config.
- Use `identityScope: "auto:userId"` when you want tenant partitioning plus optional `userId` partitioning when the active identity context provides it.
- Use `identityScope: "required"` when middleware correctness depends on `tenantId` being present and tenant-only partitioning is enough.
- Use `identityScope: "full"` when middleware correctness depends on both `tenantId` and `userId`, and you want strict per-user isolation as `<tenantId>:<userId>:...`.
- Use `identityScope: "off"` only for intentional cross-tenant sharing.
- Legacy user-aware modes such as `"required:userId"` still work, but prefer `"full"` for the clearer strict-per-user intent.
- `tenantId` must be a non-empty string, cannot contain `:`, and cannot be `__global__` because identity-aware middleware reserves those for internal namespace partitioning.
- When user-aware identity scope is enabled, `userId` must also be a non-empty string and cannot contain `:`.

Quick choice guide:

- Use omitted / `"auto"` when tenant partitioning is helpful but not mandatory.
- Use `"required"` when the task must run inside a tenant and tenant-only isolation is enough.
- Use `"full"` when the task must run inside a tenant and each user needs a separate middleware bucket.
- Use `"auto:userId"` when tenant isolation is mandatory enough to keep when present, but `userId` is only a refinement when available.
- Use `"off"` only when cross-tenant sharing is explicitly intended.

Examples:

```typescript
import { middleware } from "@bluelibs/runner";

// Tenant must exist. Keys look like: <tenantId>:...
middleware.task.rateLimit.with({
  windowMs: 60_000,
  max: 10,
  identityScope: "required",
});

// Tenant + user must both exist. Keys look like: <tenantId>:<userId>:...
middleware.task.cache.with({
  ttl: 30_000,
  identityScope: "full",
});

// Tenant is required when present, userId refines the key only when available.
middleware.task.debounce.with({
  ms: 250,
  identityScope: "auto:userId",
});
```

Runner still validates `tenantId` at middleware read time.
Extra fields belong to your app-level contract, so validate them in your custom identity context schema when correctness depends on them.

> **Platform Note:** Identity propagation requires `AsyncLocalStorage`. The built-in `asyncContexts.identity` degrades gently on unsupported runtimes: `tryUse()` returns `undefined`, `has()` returns `false`, and `provide()` still executes the callback without propagation. In contrast, `run(app, { identity: customIdentityContext })` fails fast when `AsyncLocalStorage` is unavailable.
