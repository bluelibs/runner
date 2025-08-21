## Advanced Design Patterns with Runner

This guide covers higher‑level patterns you can build using Runner’s primitives (resources, tasks, middleware, events, tags) while keeping your domain code plain and testable.

### Factory Pattern (configurable builders)

Create a resource that returns a function which builds domain objects on demand. Configure once at boot; produce instances anywhere.

```ts
import { resource, task } from "@bluelibs/runner";

class PdfRenderer {
  constructor(
    private readonly font: string,
    private readonly compress: boolean,
  ) {}
  async render(doc: unknown) {
    /* ... */
  }
}

export const pdfFactory = resource({
  id: "app.factories.pdf",
  init: async (config: { defaultFont: string; compress: boolean }) => {
    return (overrides?: Partial<{ font: string; compress: boolean }>) => {
      const font = overrides?.font ?? config.defaultFont;
      const compress = overrides?.compress ?? config.compress;
      return new PdfRenderer(font, compress);
    };
  },
});

export const exportReport = task({
  id: "app.tasks.exportReport",
  dependencies: { pdf: pdfFactory },
  run: async (input: { doc: unknown }, { pdf }) => {
    const renderer = pdf({ font: "Inter" });
    return renderer.render(input.doc);
  },
});
```

### Strategy Pattern via Tags (select implementation at runtime)

Use tags to mark strategy providers and pick one by config or input.

```ts
import { tag, resource, task } from "@bluelibs/runner";

type PricingInput = { country: string; items: { price: number }[] };
type PricingOutput = { total: number };

const pricingStrategy = tag<void, PricingInput, PricingOutput>({
  id: "pricing.strategy",
});

export const flatRate = resource({
  id: "app.pricing.flat",
  tags: [pricingStrategy],
  init: async () => async (input: PricingInput) => ({
    total: input.items.reduce((s, i) => s + i.price, 0),
  }),
});

export const byCountry = resource({
  id: "app.pricing.byCountry",
  tags: [pricingStrategy],
  init: async () => async (input: PricingInput) => ({
    total:
      input.items.reduce((s, i) => s + i.price, 0) *
      (input.country === "DE" ? 1.19 : 1.07),
  }),
});

export const priceOrder = task({
  id: "app.tasks.priceOrder",
  dependencies: {
    store: globals.resources.store,
  },
  run: async (input: PricingInput, _deps, ctx) => {
    const { store } = ctx.globals.resources; // convenience accessor
    const strategies = store.getResourcesWithTag(pricingStrategy);
    const choose = input.country === "DE" ? byCountry.id : flatRate.id;
    const strategy = strategies.find((s) => s.id === choose)?.value as (
      i: PricingInput,
    ) => Promise<PricingOutput>;
    return strategy(input);
  },
});
```

### Policy Injection via Middleware (cross‑cutting concerns)

Attach retry/timeout/caching or custom policies around tasks/resources without baking them into classes.

```ts
import { task, taskMiddleware, globals } from "@bluelibs/runner";

const audit = taskMiddleware<{ source: string }>({
  id: "app.middleware.audit",
  run: async ({ task, next }, _deps, cfg) => {
    const start = Date.now();
    try {
      const result = await next(task.input);
      // ship success log with cfg.source & tookMs
      return result;
    } catch (e) {
      // ship error log
      throw e;
    } finally {
      const tookMs = Date.now() - start;
    }
  },
});

export const critical = task({
  id: "app.tasks.critical",
  middleware: [
    globals.middleware.retry.with({ retries: 3 }),
    globals.middleware.timeout.with({ ttl: 10_000 }),
    audit.with({ source: "critical" }),
  ],
  run: async (input: unknown) => {
    /* ... */
    return "ok";
  },
});
```

### Programmatic Wiring on Ready (discovery & interception)

Scan the store on `globals.events.ready` and add behavior dynamically (routes, metrics, tracing, interceptors).

```ts
import { hook, globals, tag } from "@bluelibs/runner";

const http = tag<{ method: "GET" | "POST"; path: string }>({ id: "http" });

export const registerRoutes = hook({
  id: "app.hooks.registerRoutes",
  on: globals.events.ready,
  dependencies: {
    store: globals.resources.store,
    server: globals.resources.logger /* replace with your server */,
  },
  run: async (_, { store, server }) => {
    const tasks = store.getTasksWithTag(http);
    for (const t of tasks) {
      const cfg = http.extract(t);
      if (!cfg?.config) continue;
      // server.app[cfg.config.method.toLowerCase()](cfg.config.path, ...) // see AI.md for full example
      server.info(`Registered ${cfg.config.method} ${cfg.config.path}`);
    }
  },
});
```

### Plugin Architecture (feature islands)

Ship features as bundles: a resource that registers tasks/resources/middleware/tags and exposes only a small public surface.

```ts
import { resource, task } from "@bluelibs/runner";

const send = task({
  id: "plugin.tasks.send",
  run: async (i: { to: string; body: string }) => {
    /*...*/
  },
});

export const messagingPlugin = resource({
  id: "app.plugins.messaging",
  register: [send /*, more */],
  init: async () => ({
    send: (args: { to: string; body: string }) => send(args),
  }),
});
```

### Environment‑Specific Overrides (seams for testing and ops)

Use overrides to swap implementations by environment or test harness.

```ts
import { resource, override } from "@bluelibs/runner";

const emailer = resource({
  id: "app.emailer",
  init: async () => ({ send: async () => {} }),
});
const mockEmailer = override(emailer, {
  id: "app.emailer.mock",
  init: async () => ({
    send: async () => {
      /* no‑op */
    },
  }),
});

export const app = resource({
  id: "app",
  register: [emailer],
  overrides: [process.env.NODE_ENV === "test" ? mockEmailer : undefined].filter(
    Boolean,
  ) as any,
});
```

### Scoped Containers (see Runnerception)

Start nested runners for isolated graphs (per tenant/region/job). See `RUNNERCEPTION.md` for lifecycle details and façade patterns.

### Feature Flags via Tags

Attach flags as tags and read them in middleware or ready hooks to enable/disable routes/tasks.

```ts
import { tag, task } from "@bluelibs/runner";

const flag = tag<{ name: string; enabled: boolean }>({ id: "flag" });

export const riskyOp = task({
  id: "app.tasks.riskyOp",
  tags: [flag.with({ name: "risky", enabled: false })],
  run: async () => "ok",
});
```

### Testing Patterns

- Unit test classes and pure functions directly.
- Spin a tiny harness `resource` for integration; use `override()` to swap adapters.
- Prefer contract/tag checks for compile‑time safety; option to add runtime schemas for boundaries.

### Principles Recap

- Keep domain code plain; move wiring/lifecycle/policies to Runner.
- Prefer composition over inheritance; use factories and tags for variation.
- Make dependencies explicit; avoid hidden injection.
- Use middleware for cross‑cutting concerns and tags for behavior discovery.
