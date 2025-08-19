## Object‑Oriented Programming with Runner

Runner is excellent for wiring systems together (see `AI.md`), but that doesn’t mean you shouldn’t write classes. It means you don’t need framework‑specific classes. Keep your domain modeled with plain, testable classes, and let Runner handle lifecycle, wiring, configuration, and cross‑cutting concerns.

### Key Principles

- **No decorators or magic injection**: Your classes are plain TypeScript. Runner does not require decorators, parameter metadata, or runtime reflection tricks.
- **Container‑first composition**: Resources, tasks, events, and middleware form a predictable, testable dependency graph. Your classes are created and used through resources (or factories) rather than implicit injection.
- **init() as an async constructor**: A `resource`’s `init()` is the place to construct, connect, authenticate, warm up, or hydrate your class—anything you’d do in an async constructor. Return the fully ready value. `dispose()` is the paired destructor.
- **Explicit contracts**: Validation and tag contracts make the edges between components clear. Keep business logic in classes; keep wiring and policies in Runner definitions.

### When to Use Classes

Use classes for cohesive, stateful domains:

- **Domain services**: Pricing engine, policy evaluator, risk scorer.
- **Adapters**: Wrappers over SDKs (database, queue, cache, API clients).
- **Aggregates**: Stateful orchestrators with clear invariants and behavior.

Avoid leaking framework concepts into your classes. They should be portable and testable in isolation.

### How Classes Integrate with Runner

1. Create and configure instances via a resource

```ts
import { resource } from "@bluelibs/runner";

class Mailer {
  constructor(private readonly apiKey: string) {}
  async send(to: string, subject: string) {
    /* ... */
  }
}

export const mailer = resource({
  id: "app.resources.mailer",
  // init() is an async constructor; return the ready value
  init: async (config: { apiKey: string }) => new Mailer(config.apiKey),
  dispose: async (instance) => {
    // close connections, flush buffers, etc.
  },
});
```

2. Consume the class from tasks/hooks/resources via dependencies

```ts
import { task } from "@bluelibs/runner";
import { mailer } from "./mailer.resource";

export const sendWelcomeEmail = task({
  id: "app.tasks.sendWelcomeEmail",
  dependencies: { mailer },
  run: async (input: { email: string }, { mailer }) => {
    await mailer.send(input.email, "Welcome! ", "Glad you’re here");
    return { ok: true };
  },
});
```

No decorators; no global injection. The dependency is explicit and type‑safe.

### init() Superpowers (why it’s better than constructors)

- **Asynchronous**: Fetch tokens, open sockets, run migrations, hydrate caches before exposing the value.
- **Validated**: `configSchema`/`resultSchema` can verify configuration and post‑init result.
- **Wrapped by middleware**: Add retries, timeouts, caching, or custom policies around init.
- **Paired disposal**: `dispose()` runs in reverse order to clean up resources predictably.

### Factory Pattern (class builders)

If you need per‑call or per‑request instances, return a factory function from a resource configured once at boot:

```ts
import { resource } from "@bluelibs/runner";

class ReportBuilder {
  constructor(private readonly locale: string) {}
  build(data: unknown) {
    /* ... */
  }
}

export const reportFactory = resource({
  id: "app.resources.reportFactory",
  init: async (config: { defaultLocale: string }) => {
    return (overrides?: { locale?: string }) => {
      const locale = overrides?.locale ?? config.defaultLocale;
      return new ReportBuilder(locale);
    };
  },
});
```

This keeps class creation deterministic and centralized, while allowing flexible usage at the edges.

### Composition over Inheritance

Prefer composing small classes and wiring them in a resource over deep inheritance chains. Runner’s dependency graph and middleware make composition straightforward and observable (debuggable via tags, logs, and global events).

### Testing Strategy

- Test classes directly with plain unit tests—no Runner needed.
- For integration, run a minimal `resource`/`task` harness and use overrides to replace external adapters.
- Keep business logic in classes so tests don’t depend on framework wiring beyond what’s necessary.

### Practical Guidelines

- **Keep classes pure and portable**: no framework imports inside domain classes.
- **Use resources to manage lifecycles**: async construction, validation, and cleanup.
- **Make dependencies explicit**: wire classes through `dependencies` rather than hidden injection.
- **Leverage middleware for policies**: retries, timeouts, caching—don’t bake these into classes.
- **Adopt tags for discoverability**: enable programmatic wiring (routing, tracing, etc.) without coupling.

In short: write great classes; let Runner do the wiring. You gain strong lifecycle guarantees, composability, and zero‑magic ergonomics without sacrificing OOP design.
