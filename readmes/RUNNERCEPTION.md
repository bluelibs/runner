## Runnerception: Private Containers inside Resources

Sometimes you want an isolated dependency graph that lives inside a single resource: a private container with its own tasks, resources, middleware, and overrides. You can achieve this by starting a nested Runner from within a resource’s `init()` and disposing it in `dispose()`.

### Why do this?

- **Bounded context isolation**: Keep a sub‑system’s wiring, policies, and overrides self‑contained.
- **Multi‑tenant per‑instance containers**: Spin up one inner container per tenant/region/project.
- **Plugin sandboxes**: Run third‑party or experimental modules without polluting the global graph.
- **Lifecycle scoping**: Start/stop an entire sub‑graph with the parent resource.

### Pattern overview

1. Define the inner graph (root resource with its own registrations).
2. From the outer resource’s `init()`, call `run(innerRoot, options)`.
3. Return a façade that proxies into the inner runner (or return the inner `RunResult` directly).
4. In `dispose()`, call `inner.dispose()`.

### Example: Per‑tenant private container

```ts
import { resource, run, task } from "@bluelibs/runner";

// --- Inner graph (private sub‑system) ---
const greet = task({
  id: "tenant.tasks.greet",
  run: async (input: { name: string }) => `Hello, ${input.name}!`,
});

const tenantApp = resource({
  id: "tenant.app",
  register: [greet],
  init: async () => ({ ready: true }),
});

// --- Outer resource that owns a private runner per tenant ---
export const tenantContainer = resource({
  id: "app.resources.tenantContainer",
  init: async (config: { tenantId: string }) => {
    // Start a private container with its own debug/logging/overrides
    const inner = await run(tenantApp, {
      debug: "normal",
      logs: { printThreshold: null },
    });

    // Expose a minimal façade; avoid leaking the entire inner container if not needed
    return {
      tenantId: config.tenantId,
      greet: async (name: string) =>
        inner.runTask("tenant.tasks.greet", { name }),
      // Optionally, expose getters:
      getInner: () => inner, // give full access only if you trust the caller
      disposeInner: () => inner.dispose(),
    };
  },
  dispose: async (facade) => {
    // Ensure the inner container is fully disposed
    await facade.disposeInner();
  },
});

// Usage in another task/resource
export const welcome = task({
  id: "app.tasks.welcome",
  dependencies: { tenant: tenantContainer },
  run: async (input: { name: string }, { tenant }) => {
    return tenant.greet(input.name);
  },
});
```

### Example: Private adapters and policies

Give the inner container its own middleware, tags, and overrides without affecting the global graph.

```ts
import { resource, run, task, globals, taskMiddleware } from "@bluelibs/runner";

const audit = taskMiddleware({
  id: "tenant.middleware.audit",
  run: async ({ task, next }) => {
    const startedAt = Date.now();
    const result = await next(task.input);
    const tookMs = Date.now() - startedAt;
    // Ship audit logs somewhere tenant‑specific
    return result;
  },
});

const expensive = task({
  id: "tenant.tasks.expensive",
  middleware: [
    globals.middleware.retry.with({ retries: 2 }),
    globals.middleware.timeout.with({ ttl: 5000 }),
    audit,
  ],
  run: async () => {
    /* ... */
    return "ok";
  },
});

const innerRoot = resource({
  id: "tenant.innerRoot",
  register: [expensive],
});

export const privateRunner = resource({
  id: "app.resources.privateRunner",
  init: async (cfg: { logs?: boolean }) => {
    const inner = await run(innerRoot, {
      logs: { printThreshold: cfg.logs ? "info" : null },
    });
    return {
      run: inner.runTask,
      dispose: inner.dispose,
    };
  },
  dispose: async (api) => api.dispose(),
});
```

### Tips and caveats

- **Dispose correctly**: Always call `inner.dispose()` from the parent’s `dispose()`.
- **Avoid cycles**: The inner graph should not depend back on the parent resource.
- **Keep the façade small**: Expose only what you need (e.g., specific task calls), not the whole inner store, to preserve isolation.
- **Resource intensity**: Spinning many inner containers can be expensive. Consider pooling or a shared inner container keyed by config.
- **Overrides and tags**: Inner overrides will not leak globally. Use tags and `globals.events.ready` inside the inner graph for programmatic wiring.
- **Debugging**: Give the inner container its own `debug`/`logs` config for focused traces.

Runnerception lets you scope complex wiring behind a single resource boundary. You keep your global graph clean while gaining sandboxed composition where needed.
