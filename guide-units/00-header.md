# BlueLibs Runner

### Explicit TypeScript Dependency Injection Toolkit

**Build apps from tasks and resources with explicit dependencies, predictable lifecycle, and first-class testing**

Runner is a TypeScript-first toolkit for building an `app` out of small, typed building blocks. You can find more details and a visual overview at [runner.bluelibs.com](https://runner.bluelibs.com/).

- **Tasks**: async functions with explicit `dependencies`, middleware, and input/output validation
- **Resources**: singletons with `init`/`dispose` lifecycle (databases, clients, servers, caches)
- **Reliability Middleware**: built-in `retry`, `timeout`, `circuitBreaker`, `cache`, and `rateLimit`
- **HTTP Tunnels**: cross-process execution (the "Distributed Monolith") with zero call-site changes
- **Durable Workflows**: persistent, crash-recoverable async logic for Node.js
- **Events & hooks**: typed signals and subscribers for decoupling
- **Runtime control**: run, observe, test, and dispose your `app` predictably

The goal is simple: keep dependencies explicit, keep lifecycle predictable, and make your runtime easy to control in production and in tests.

<p align="center">
<a href="https://github.com/bluelibs/runner/actions/workflows/ci.yml"><img src="https://github.com/bluelibs/runner/actions/workflows/ci.yml/badge.svg?branch=main" alt="Build Status" /></a>
<a href="https://github.com/bluelibs/runner"><img src="https://img.shields.io/badge/coverage-100%25-brightgreen" alt="Coverage 100% is enforced" /></a>
<a href="https://bluelibs.github.io/runner/" target="_blank"><img src="https://img.shields.io/badge/read-typedocs-blue" alt="Docs" /></a>
<a href="https://www.npmjs.com/package/@bluelibs/runner"><img src="https://img.shields.io/npm/v/@bluelibs/runner.svg" alt="npm version" /></a>
<a href="https://www.npmjs.com/package/@bluelibs/runner"><img src="https://img.shields.io/npm/dm/@bluelibs/runner.svg" alt="npm downloads" /></a>
</p>

```typescript
import { r, run, globals } from "@bluelibs/runner";
import { z } from "zod";

const db = r
  .resource("app.db")
  .init(async () => ({
    users: {
      insert: async (input: { name: string; email: string }) => ({
        id: "user-1",
        ...input,
      }),
    },
  }))
  .build();

const mailer = r
  .resource("app.mailer")
  .init(async () => ({
    sendWelcome: async (email: string) => {
      console.log(`Sending welcome email to ${email}`);
    },
  }))
  .build();

// Define a task with dependencies, middleware, and zod validation
const createUser = r
  .task("users.create")
  .dependencies({ db, mailer })
  .middleware([globals.middleware.task.retry.with({ attempts: 3 })])
  .inputSchema(z.object({ name: z.string(), email: z.string().email() }))
  .run(async (input, { db, mailer }) => {
    const user = await db.users.insert(input);
    await mailer.sendWelcome(user.email);
    return user;
  })
  .build();

// Compose resources and run your application
const app = r.resource("app").register([db, mailer, createUser]).build();
const runtime = await run(app);
await runtime.runTask(createUser, { name: "Ada", email: "ada@example.com" });
// await runtime.dispose() when you are done.
```

---

| Resource                                                                                                            | Type    | Description                         |
| ------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------- |
| [Official Website & Documentation](https://runner.bluelibs.com/)                                                    | Website | Overview and features               |
| [GitHub Repository](https://github.com/bluelibs/runner)                                                             | GitHub  | Source code, issues, and releases   |
| [Runner Dev Tools](https://github.com/bluelibs/runner-dev)                                                          | GitHub  | Development CLI and tooling         |
| [API Documentation](https://bluelibs.github.io/runner/)                                                             | Docs    | TypeDoc-generated reference         |
| [AI-Friendly Docs](./readmes/AI.md)                                                                                 | Docs    | Compact summary (<5000 tokens)      |
| [Full Guide](./readmes/FULL_GUIDE.md)                                                                               | Docs    | Complete documentation (composed)   |
| [Design Documents](https://github.com/bluelibs/runner/tree/main/readmes)                                            | Docs    | Architecture notes and deep dives   |
| [Example: Express + OpenAPI + SQLite](https://github.com/bluelibs/runner/tree/main/examples/express-openapi-sqlite) | Example | REST API with OpenAPI specification |
| [Example: Fastify + MikroORM + PostgreSQL](https://github.com/bluelibs/runner/tree/main/examples/fastify-mikroorm)  | Example | Full-stack application with ORM     |

### Community & Policies

- [Code of Conduct](./.github/CODE_OF_CONDUCT.md)
- [Contributing](./.github/CONTRIBUTING.md)
- [Security](./.github/SECURITY.md)

## Choose Your Path

- **New to Runner**: Start with [Your First 5 Minutes](#your-first-5-minutes)
- **Prefer an end-to-end example**: Jump to [Quick Start](#quick-start) or the [Real-World Example](https://github.com/bluelibs/runner/blob/main/readmes/FULL_GUIDE.md#real-world-example-the-complete-package)
- **Need Node-only capabilities**: See [Durable Workflows](./readmes/DURABLE_WORKFLOWS.md)
- **Need remote execution**: See [HTTP Tunnels](./readmes/TUNNELS.md) (expose from Node.js, call from any `fetch` runtime)
- **Care about portability**: Read [Multi-Platform Architecture](./readmes/MULTI_PLATFORM.md)
- **Want the complete guide**: Read [FULL_GUIDE.md](./readmes/FULL_GUIDE.md)
- **Want the short version**: Read [AI.md](./readmes/AI.md)

## Platform Support (Quick Summary)

| Capability                                              | Node.js | Browser | Edge | Notes                                      |
| ------------------------------------------------------- | ------- | ------- | ---- | ------------------------------------------ |
| Core runtime (tasks/resources/middleware/events/hooks) | Full    | Full    | Full | Platform adapters hide runtime differences |
| Async Context (`r.asyncContext`)            | Full    | None    | None | Requires Node.js `AsyncLocalStorage`       |
| Durable workflows (`@bluelibs/runner/node`) | Full    | None    | None | Node-only module                           |
| Tunnels client (`createExposureFetch`)      | Full    | Full    | Full | Requires `fetch`                           |
| Tunnels server (`@bluelibs/runner/node`)    | Full    | None    | None | Exposes tasks/events over HTTP             |

---
