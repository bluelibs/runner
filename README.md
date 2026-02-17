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

// resources are singletons with lifecycle management and async construction
const db = r
  .resource("app.db")
  .init(async () => ({
    const conn = await postgres.connect(process.env.DB_URL);
    return conn;
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
| [Support & Release Policy](./readmes/ENTERPRISE.md)                                                                 | Docs    | Support windows and deprecation     |
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
- **Planning upgrades**: See [Support & Release Policy](./readmes/ENTERPRISE.md)
- **Want the complete guide**: Read [FULL_GUIDE.md](./readmes/FULL_GUIDE.md)
- **Want the short version**: Read [AI.md](./readmes/AI.md)

## Platform Support (Quick Summary)

| Capability                                             | Node.js | Browser | Edge | Notes                                      |
| ------------------------------------------------------ | ------- | ------- | ---- | ------------------------------------------ |
| Core runtime (tasks/resources/middleware/events/hooks) | Full    | Full    | Full | Platform adapters hide runtime differences |
| Async Context (`r.asyncContext`)                       | Full    | None    | None | Requires Node.js `AsyncLocalStorage`       |
| Durable workflows (`@bluelibs/runner/node`)            | Full    | None    | None | Node-only module                           |
| Tunnels client (`createHttpClient`)                    | Full    | Full    | Full | Requires `fetch`                           |
| Tunnels server (`@bluelibs/runner/node`)               | Full    | None    | None | Exposes tasks/events over HTTP             |

---

## Prerequisites

Use these minimums before starting:

| Requirement     | Minimum                 | Notes                                                                   |
| --------------- | ----------------------- | ----------------------------------------------------------------------- |
| Node.js         | `18.x`                  | Enforced by `package.json#engines.node`                                 |
| TypeScript      | `5.6+` (recommended)    | Required for typed DX and examples in this repository                   |
| Package manager | npm / pnpm / yarn / bun | Examples use npm, but any modern package manager works                  |
| `fetch` runtime | Built-in or polyfilled  | Required for tunnel clients (`createHttpClient`, universal HTTP client) |

If you use the Node-only package (`@bluelibs/runner/node`) for durable workflows or exposure, stay on a supported Node LTS line.

---
## Your First 5 Minutes

**New to Runner?** Here's the absolute minimum you need to know:

1. **Tasks** are your business logic functions (with dependencies and middleware)
2. **Resources** are shared services (database, config, clients) with lifecycle (`init` / `dispose`)
3. **You compose everything** under an `app` resource with `.register([...])`
4. **You run it** with `run(app)` which gives you `runTask()` and `dispose()`

That's it. Now let's get you to a first successful run.

---

## Quick Start

This is the fastest way to run the TypeScript example at the top of this README:

0. Confirm prerequisites from [Prerequisites](#prerequisites) (Node `18+`, TypeScript `5.6+` recommended)

1. Install dependencies:

```bash
npm i @bluelibs/runner zod
npm i -D typescript tsx
```

2. Copy the example into `index.ts`
3. Run it:

```bash
npx tsx index.ts
```

**That's it!** You now have a working `Runtime` and you can execute tasks with `runtime.runTask(...)`.

> **Tip:** If you prefer an end-to-end example with HTTP, OpenAPI, and persistence, jump to the examples below.

---

## Runner Dev Tools Quick Start

`@bluelibs/runner-dev` gives you CLI scaffolding and runtime introspection.

1. Install (or run without install):

```bash
npm install -g @bluelibs/runner-dev
# or
npx @bluelibs/runner-dev --help
```

2. Three common commands:

```bash
# Scaffold a new Runner project
runner-dev new my-app --install

# Query tasks from a local TypeScript entry file (dry-run mode)
runner-dev query 'query { tasks { id } }' --entry-file ./src/main.ts

# Inspect a running app via GraphQL endpoint
ENDPOINT=http://localhost:1337/graphql runner-dev overview --details 10
```

For full CLI and Dev UI docs, see [Runner Dev Tools](https://github.com/bluelibs/runner-dev).

---

## Real-World Examples

- [Express + OpenAPI + SQLite](./examples/express-openapi-sqlite/README.md)
- [Fastify + MikroORM + PostgreSQL](./examples/fastify-mikroorm/README.md)

---

## Where To Go Next

- **Complete guide**: Read [FULL_GUIDE.md](./readmes/FULL_GUIDE.md) (the full reference, composed from `guide-units/`)
- **Popular guide sections**:
  - [Tasks](https://github.com/bluelibs/runner/blob/main/readmes/FULL_GUIDE.md#tasks)
  - [Resources](https://github.com/bluelibs/runner/blob/main/readmes/FULL_GUIDE.md#resources)
  - [Middleware](https://github.com/bluelibs/runner/blob/main/readmes/FULL_GUIDE.md#middleware)
  - [Testing](https://github.com/bluelibs/runner/blob/main/readmes/FULL_GUIDE.md#testing)
  - [Troubleshooting](https://github.com/bluelibs/runner/blob/main/readmes/FULL_GUIDE.md#troubleshooting)
- **API reference**: Browse the [TypeDoc documentation](https://bluelibs.github.io/runner/)
- **Token-friendly overview**: Read [AI.md](./readmes/AI.md)
- **Node-only features**:
  - [Durable Workflows](./readmes/DURABLE_WORKFLOWS.md)
  - [HTTP Tunnels](./readmes/TUNNELS.md)
- **Releases and upgrades**:
  - [GitHub Releases](https://github.com/bluelibs/runner/releases)
  - [Support & Release Policy](./readmes/ENTERPRISE.md)
- **Operational baseline**:
  - [Production Readiness Checklist](./readmes/FULL_GUIDE.md#production-readiness-checklist)
- **Multi-platform architecture**: Read [MULTI_PLATFORM.md](./readmes/MULTI_PLATFORM.md)

---

## License

This project is licensed under the MIT License - see [LICENSE.md](./LICENSE.md).
