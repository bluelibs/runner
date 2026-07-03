## Security

Runner gives you the right hooks to propagate identity, partition framework-managed state, and enforce task-level access rules without scattering security checks through the system.
Authentication itself is still decided by your app: Runner does not choose your auth provider, session model, token strategy, or user lookup flow.
In Runner, "identity" means the async-context payload used to partition framework-managed state and enforce identity gates. It is not an identity-provider or authentication-service abstraction.

The story usually looks like this:

- If you do nothing, Runner uses the built-in `asyncContexts.identity` as the active runtime identity context.
- If your app needs extra runtime-validated fields such as `userId`, define your own async context, register it, and pass it to `run(app, { identity })` so Runner switches its internal identity-aware middleware to that context for this runtime.
- If your SaaS has users but no real tenant model, you can still use the built-in identity-aware middleware by providing a constant tenant such as `tenantId: "app"` at ingress and treating it as your single shared tenant namespace.

From there, the pattern is straightforward: ingress binds identity, tasks and helpers read it, middleware can partition internal state with it, and task identity gates can block execution when the active identity is missing or not authorized.

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
The flow is simple: ingress provides the identity, identity-sensitive tasks require it, downstream code reads it, and identity-aware middleware partitions internal keys with `<tenantId>:` when identity context exists.
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
    middleware.task.cache.with({
      ttl: 30_000,
      identityScope: { tenant: true },
    }),
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
If it is not registered, `run(app, { identity })` still auto-registers it under the runner namespace for runtime dependency usage.
Transport features remain stricter: HTTP clients, exposure, and remote lanes can only serialize or hydrate contexts that are registered and explicitly forwarded.

### Access Patterns

Once identity is available, there are two normal access styles:

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

Identity-aware middleware automatically uses the tenant keyspace when identity context exists, even when you omit `identityScope`.
That means `cache`, `rateLimit`, `debounce`, `throttle`, and `concurrency` prefix their internal keys with `<tenantId>:` by default whenever a tenant identity is active.

This is the "partition state" part of the story. It affects middleware-managed buckets and keys, not whether a task is allowed to run.

- Use `identity.provide({ tenantId }, fn)` at HTTP, RPC, queue, or job ingress.
- Use `identity.require()` or `identity.use()` when running without an identity would be a correctness bug.
- `identity.require()` does not validate optional fields such as `userId` or `roles` on the built-in identity context. Prefer `middleware.task.identityChecker` or `subtree({ tasks: { identity: ... } })` when access rules depend on the active user, or use a custom identity context when you want those fields required as part of the identity contract itself.
- Omit `identityScope` to use the default tenant-aware behavior without requiring identity to exist.
- Use `identityScope: { tenant: false }` when middleware state should stay global across all identities, even if tenant context exists.
- Use `identityScope: { tenant: true }` when middleware correctness depends on `tenantId` being present and tenant-only partitioning is enough.
- Use `identityScope: { tenant: true, user: true }` when middleware correctness depends on both `tenantId` and `userId`, and you want strict per-user isolation as `<tenantId>:<userId>:...`.
- `required` defaults to `true` whenever `identityScope` is present with `tenant: true`. That means Runner throws `identityContextRequiredError` if the scoped identity fields are missing. Set `required: false` only when identity should refine the key when present instead of being mandatory.
- Resource subtree policy can enforce one shared middleware scope with `subtree({ middleware: { identityScope: { tenant: true, user: true } } })`. Runner applies that policy only to task middleware tagged with `tags.identityScoped`, fills missing `identityScope`, and requires the same effective scope when middleware config already declares one.
- If your app is effectively single-tenant, an explicit constant such as `tenantId: "app"` is a reasonable way to keep using these scopes without inventing fake tenant logic elsewhere.
- `tenantId` must be a non-empty string, cannot contain `:`, and cannot be `__global__` because identity-aware middleware reserves those for internal namespace partitioning.
- When user-aware identity scope is enabled, `userId` must also be a non-empty string and cannot contain `:`.
- When roles are present on the identity payload, they must be a string array with no empty entries.
- Cache key invalidation is raw by default. You may either pass the fully scoped key yourself or opt into helper scoping with `cache.invalidateKeys(key, { identityScope })`.
- Cache refs stay raw. If invalidation should respect tenant or user boundaries, build refs through an app helper such as `CacheRefs.getTenantId()` so `keyBuilder` and `invalidateRefs(...)` share the exact same tenant-aware ref format.

Quick choice guide:

- Omit `identityScope` for the default automatic tenant scope that activates only when identity exists.
- Use `{ tenant: false }` when middleware-managed state must stay shared across tenants and users.
- Use `{ tenant: true }` when the task must run inside a tenant and tenant-only isolation is enough.
- Use `{ tenant: true, user: true }` when the task must run inside a tenant and each user needs a separate middleware bucket.
- Add `required: false` when tenant or user data should only refine an existing key rather than being mandatory. Otherwise the default `required: true` behavior fails fast with `identityContextRequiredError`.
- If the app has users but no tenant model, provide a constant tenant such as `"app"` and then use `{ tenant: true, user: true }` for per-user buckets under that one shared tenant.

### Task Identity Gates

Task identity gates are separate from `identityScope`.
`identityScope` partitions middleware-managed state such as cache keys or rate-limit buckets.
Task identity gates are the "allow or block execution" part of the story.

- `subtree({ tasks: { identity: {} } })` means every task in that subtree requires tenant identity.
- Mentioning `tasks.identity` implies `tenant: true`, so `{ user: true }` means tenant + user and `{ roles: ["ADMIN"] }` still requires tenant.
- `subtree({ tasks: { identity: ... } })` is declarative sugar for runner-owned `identityChecker` middleware attached to matching tasks.
- `roles` use OR semantics inside one gate: at least one configured role must match.
- Runner treats roles literally. If your app has inherited roles such as `ADMIN -> MANAGER -> USER`, expand the effective roles in your auth layer before binding identity, then gate on the lowest role the task actually needs.
- Nested resources add gates additively, so all owner-resource layers must pass.
- `middleware.task.identityChecker.with({ ... })` uses the same gate contract for one explicit middleware layer.
- Explicit identity-sensitive config fails fast at boot on platforms without `AsyncLocalStorage`. That includes `tasks.identity`, `middleware.task.identityChecker`, middleware `identityScope` values that enable tenant partitioning, and `subtree.middleware.identityScope` values that enable tenant partitioning.

```typescript
import { asyncContexts, r, run } from "@bluelibs/runner";

const approveRefund = r.task("approveRefund").run(async () => "ok").build();

const supportArea = r
  .resource("supportArea")
  .subtree({
    tasks: {
      identity: { roles: ["SUPPORT"] },
    },
  })
  .register([approveRefund])
  .build();

const app = r
  .resource("app")
  .subtree({
    tasks: {
      identity: { user: true, roles: ["ADMIN"] },
    },
  })
  .register([supportArea])
  .build();

const runtime = await run(app);

await asyncContexts.identity.provide(
  { tenantId: "acme", userId: "u1", roles: ["ADMIN", "SUPPORT"] },
  () => runtime.runTask(approveRefund),
);
```

`approveRefund` inherits both subtree gates, so the call above passes only because the active identity satisfies tenant + user and both role layers: `ADMIN` from `app` and `SUPPORT` from `supportArea`.

```typescript
import { middleware } from "@bluelibs/runner";

middleware.task.identityChecker.with({
  tenant: true, // by default
  user: true,
  roles: ["ADMIN", "SUPPORT"], // has ADMIN or SUPPORT role
});
```

Examples of middleware state partitioning:

```typescript
import { middleware } from "@bluelibs/runner";

// Tenant must exist. Keys look like: <tenantId>:...
middleware.task.rateLimit.with({
  windowMs: 60_000,
  max: 10,
  identityScope: { tenant: true },
});

// Tenant + user must both exist. Keys look like: <tenantId>:<userId>:...
middleware.task.cache.with({
  ttl: 30_000,
  identityScope: { tenant: true, user: true },
});

// Tenant and user refine the key only when identity exists.
middleware.task.debounce.with({
  ms: 250,
  identityScope: { required: false, tenant: true, user: true },
});
```

Runner still validates `tenantId` at middleware read time.
Extra fields belong to your app-level contract, so validate them in your custom identity context schema when correctness depends on them.

The practical split is:

- identity context answers "who is this execution running as?"
- `identityScope` answers "should middleware-managed state be partitioned by that identity?"
- task identity gates answer "is this task allowed to run under this identity?"

> **Platform Note:** Identity propagation requires `AsyncLocalStorage`. The built-in `asyncContexts.identity` degrades gently on unsupported runtimes: `tryUse()` returns `undefined`, `has()` returns `false`, and `provide()` still executes the callback without propagation. In contrast, `run(app, { identity: customIdentityContext })` fails fast when `AsyncLocalStorage` is unavailable.
