# Advanced Design Patterns with Runner

← [Back to main README](../README.md) | [Factory Pattern in FULL_GUIDE](./FULL_GUIDE.md#factory-pattern)

---

This guide covers higher‑level patterns you can build using Runner's primitives (resources, tasks, middleware, events, tags) while keeping your domain code plain and testable.

### Factory Pattern (configurable builders)

Create a resource that returns a function which builds domain objects on demand. Configure once at boot; produce instances anywhere.

```ts
import { r } from "@bluelibs/runner";

class PdfRenderer {
  constructor(
    private readonly font: string,
    private readonly compress: boolean,
  ) {}
  async render(doc: unknown) {
    /* ... */
  }
}

export const pdfFactory = r
  .resource("app.factories.pdf")
  .init(async (config: { defaultFont: string; compress: boolean }) => {
    return (overrides?: Partial<{ font: string; compress: boolean }>) => {
      const font = overrides?.font ?? config.defaultFont;
      const compress = overrides?.compress ?? config.compress;
      return new PdfRenderer(font, compress);
    };
  })
  .build();

export const exportReport = r
  .task("app.tasks.exportReport")
  .dependencies({ pdf: pdfFactory })
  .run(async (input: { doc: unknown }, { pdf }) => {
    const renderer = pdf({ font: "Inter" });
    return renderer.render(input.doc);
  })
  .build();
```

### Strategy Pattern via Tags (select implementation at runtime)

Use tags to mark strategy providers and pick one by config or input.

```ts
import { r, globals } from "@bluelibs/runner";

type PricingInput = { country: string; items: { price: number }[] };
type PricingOutput = { total: number };

const pricingStrategy = r
  .tag<void, PricingInput, PricingOutput>("pricing.strategy")
  .build();

export const flatRate = r
  .resource("app.pricing.flat")
  .tags([pricingStrategy])
  .init(async () => async (input: PricingInput) => ({
    total: input.items.reduce((s, i) => s + i.price, 0),
  }))
  .build();

export const byCountry = r
  .resource("app.pricing.byCountry")
  .tags([pricingStrategy])
  .init(async () => async (input: PricingInput) => ({
    total:
      input.items.reduce((s, i) => s + i.price, 0) *
      (input.country === "DE" ? 1.19 : 1.07),
  }))
  .build();

export const priceOrder = r
  .task("app.tasks.priceOrder")
  .dependencies({ store: globals.resources.store })
  .run(async (input: { input: PricingInput }, { store }) => {
    const strategies = store.getResourcesWithTag(pricingStrategy);
    const choose = input.country === "DE" ? byCountry.id : flatRate.id;
    const strategy = strategies.find((s) => s.id === choose)?.value as (
      i: PricingInput,
    ) => Promise<PricingOutput>;
    return strategy(input);
  })
  .build();
```

### Policy Injection via Middleware (cross‑cutting concerns)

Attach retry/timeout/caching or custom policies around tasks/resources without baking them into classes.

```ts
import { r, globals } from "@bluelibs/runner";

const audit = r.middleware
  .task("app.middleware.audit")
  .run(async ({ task, next }, _deps, cfg: { source: string }) => {
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
  })
  .build();

export const critical = r
  .task("app.tasks.critical")
  .middleware([
    globals.middleware.retry.with({ retries: 3 }),
    globals.middleware.timeout.with({ ttl: 10_000 }),
    audit.with({ source: "critical" }),
  ])
  .run(async () => {
    /* ... */
    return "ok";
  })
  .build();
```

### Programmatic Wiring on Ready (discovery & interception)

Scan the store on `globals.events.ready` and add behavior dynamically (routes, metrics, tracing, interceptors).

```ts
import { r, globals } from "@bluelibs/runner";

const http = r.tag<{ method: "GET" | "POST"; path: string }>("http").build();

export const registerRoutes = r
  .hook("app.hooks.registerRoutes")
  .on(globals.events.ready)
  .dependencies({
    store: globals.resources.store,
    server: globals.resources.logger /* replace with your server */,
  })
  .run(async (_e, { store, server }) => {
    const tasks = store.getTasksWithTag(http);
    for (const t of tasks) {
      const cfg = http.extract(t);
      if (!cfg?.config) continue;
      // server.app[cfg.config.method.toLowerCase()](cfg.config.path, ...) // see AI.md for full example
      server.info(`Registered ${cfg.config.method} ${cfg.config.path}`);
    }
  })
  .build();
```

### Plugin Architecture (feature islands)

Ship features as bundles: a resource that registers tasks/resources/middleware/tags and exposes only a small public surface.

```ts
import { r } from "@bluelibs/runner";

const send = r
  .task("plugin.tasks.send")
  .run(async ({ input: i }: { input: { to: string; body: string } }) => {
    /*...*/
  })
  .build();

export const messagingPlugin = r
  .resource("app.plugins.messaging")
  .register([send /*, more */])
  .init(async () => ({
    send: (args: { to: string; body: string }) => send(args),
  }))
  .build();
```

### Environment‑Specific Overrides (seams for testing and ops)

Use overrides to swap implementations by environment or test harness.

```ts
import { r, override } from "@bluelibs/runner";

const emailer = r
  .resource("app.emailer")
  .init(async () => ({ send: async () => {} }))
  .build();
const mockEmailer = override(emailer, {
  id: "app.emailer.mock",
  init: async () => ({
    send: async () => {
      /* no‑op */
    },
  }),
});

export const app = r
  .resource("app")
  .register([emailer])
  .overrides(
    [(process.env.NODE_ENV === "test" ? mockEmailer : undefined)!].filter(
      Boolean,
    ) as any,
  )
  .build();
```

### Scoped Containers (see Runnerception)

Start nested runners for isolated graphs (per tenant/region/job). See `RUNNERCEPTION.md` for lifecycle details and façade patterns.

### Feature Flags via Tags

Attach flags as tags and read them in middleware or ready hooks to enable/disable routes/tasks.

```ts
import { r } from "@bluelibs/runner";

const flag = r.tag<{ name: string; enabled: boolean }>("flag").build();

export const riskyOp = r
  .task("app.tasks.riskyOp")
  .tags([flag.with({ name: "risky", enabled: false })])
  .run(async () => "ok")
  .build();
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
