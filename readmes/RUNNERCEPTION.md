# Runnerception: Private Containers inside Resources

> **Prerequisites**: Familiarity with [Resources, Tasks, and the fluent builder API](../AI.md) is assumed.

Sometimes you want an isolated dependency graph that lives inside a single resource: a private container with its own tasks, resources, middleware, and overrides. You can achieve this by starting a nested Runner from within a resource's `init()` and disposing it in `dispose()`.

## Why do this?

- **Bounded context isolation**: Keep a sub-system's wiring, policies, and overrides self-contained.
- **Multi-tenant per-instance containers**: Spin up one inner container per tenant/region/project.
- **Plugin sandboxes**: Run third-party or experimental modules without polluting the global graph.
- **Lifecycle scoping**: Start/stop an entire sub-graph with the parent resource.

## Pattern overview

1. **Define the inner graph** — Create a root resource with its own registrations.
2. **Start the inner Runner** — From the outer resource's `init()`, call `run(innerRoot, options)`.
3. **Return a facade** — Expose a minimal API that proxies calls into the inner runner (e.g., wrapper functions that call `inner.runTask()`).
4. **Dispose cleanly** — In the outer resource's `dispose()`, call `inner.dispose()`.

## Example: Per-tenant private container

```ts
import { r, run } from "@bluelibs/runner";

// --- Inner graph (private sub-system) ---
const greet = r
  .task("tenant.tasks.greet")
  .run(async (input: { name: string }) => `Hello, ${input.name}!`)
  .build();

const tenantApp = r
  .resource("tenant.app")
  .register([greet])
  .init(async () => ({ ready: true }))
  .build();

// --- Outer resource that owns a private runner per tenant ---
export const tenantContainer = r
  .resource("app.resources.tenantContainer")
  .init(async (config: { tenantId: string }) => {
    // Start a private container with its own debug/logging/overrides
    const inner = await run(tenantApp, {
      debug: "normal",
      logs: { printThreshold: null },
    });

    // Expose a minimal facade; avoid leaking the entire inner container
    return {
      tenantId: config.tenantId,
      greet: async (name: string) => inner.runTask(greet, { name }),
      // Optionally expose full access (only if you trust the caller):
      getInner: () => inner,
      disposeInner: () => inner.dispose(),
    };
  })
  .dispose(async (facade) => {
    // Ensure the inner container is fully disposed
    await facade.disposeInner();
  })
  .build();

// Usage in another task/resource
export const welcome = r
  .task("app.tasks.welcome")
  .dependencies({ tenant: tenantContainer })
  .run(async (input: { name: string }, { tenant }) => {
    return tenant.greet(input.name);
  })
  .build();
```

## Example: Private adapters and policies

Give the inner container its own middleware, tags, and overrides without affecting the global graph.

```ts
import { r, run, globals } from "@bluelibs/runner";

const audit = r.middleware
  .task("tenant.middleware.audit")
  .run(async ({ task, next }) => {
    const startedAt = Date.now();
    const result = await next(task.input);
    const durationMs = Date.now() - startedAt;
    // Example: log or ship audit data to a tenant-specific destination
    console.log(`[audit] ${task.definition.id} took ${durationMs}ms`);
    return result;
  })
  .build();

const expensive = r
  .task("tenant.tasks.expensive")
  .middleware([
    globals.middleware.retry.with({ retries: 2 }),
    globals.middleware.timeout.with({ ttl: 5000 }),
    audit,
  ])
  .run(async () => {
    /* ... */
    return "ok";
  })
  .build();

const innerRoot = r.resource("tenant.innerRoot").register([expensive]).build();

export const privateRunner = r
  .resource("app.resources.privateRunner")
  .init(async (cfg: { logs?: boolean }) => {
    const inner = await run(innerRoot, {
      logs: { printThreshold: cfg.logs ? "info" : null },
    });
    return {
      run: <I, R>(task: { id: string }, input: I) =>
        inner.runTask(task.id, input) as Promise<R>,
      dispose: inner.dispose,
    };
  })
  .dispose(async (api) => api.dispose())
  .build();
```

## Tips and caveats

- **Dispose correctly** — Always call `inner.dispose()` from the parent's `dispose()` to avoid resource leaks.

- **Avoid cycles** — The inner graph should not depend back on the parent resource or its dependencies.

- **Keep the facade small** — Expose only what you need (e.g., specific task calls), not the whole inner store, to preserve isolation.

- **Resource intensity** — Spinning many inner containers can be expensive. Consider pooling or a shared inner container keyed by config.

- **Overrides and tags** — Inner overrides will not leak globally. Use tags and `globals.events.ready` inside the inner graph for programmatic wiring.

- **Debugging** — Give the inner container its own `debug`/`logs` config for focused traces.

---

Runnerception lets you scope complex wiring behind a single resource boundary. You keep your global graph clean while gaining sandboxed composition where needed.

<!-- Why "Runnerception"? It's runners inside runners — inspired by the film Inception. -->
