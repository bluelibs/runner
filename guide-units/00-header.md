# BlueLibs Runner

## Explicit TypeScript Dependency Injection Toolkit

**Build apps from tasks and resources with explicit dependencies, predictable lifecycle, and first-class testing**

Runner is a TypeScript-first toolkit for building an `app` out of small, typed building blocks. You can find more details and a visual overview at [runner.bluelibs.com](https://runner.bluelibs.com/).

- **Tasks**: async business actions with explicit `dependencies`, middleware, and input/output validation
- **Resources**: singletons with a four-phase lifecycle: `init`, `ready`, `cooldown`, `dispose`
- **Reliability Middleware**: built-in `retry`, `timeout`, `circuitBreaker`, `cache`, and `rateLimit`
- **Remote Lanes**: cross-process execution (the "Distributed Monolith") with zero call-site changes
- **Durable Workflows**: persistent, crash-recoverable async logic for Node.js
- **Events & hooks**: typed signals and subscribers for decoupling
- **Runtime control**: run, observe, test, pause, recover, and dispose your `app` predictably

The goal is simple: keep dependencies explicit, keep lifecycle predictable, and make your runtime easy to control in production and in tests.

## Versioning & Support

Runner follows a simple support policy so teams can plan upgrades without guesswork.

- **`6.x`**: actively maintained. New features, improvements, bug fixes, and documentation updates land here first.
- **`5.x`**: LTS through **December 31, 2026**. Critical fixes and important maintenance can continue there, but new development is focused on `6.x`.

If you are starting a new project, use `6.x`.
If you are on `5.x`, you have a stable upgrade window through the end of 2026.

See [Support & Release Policy](./readmes/ENTERPRISE.md) for the full versioning and support policy.

<p align="center">
<a href="https://github.com/bluelibs/runner/actions/workflows/ci.yml"><img src="https://github.com/bluelibs/runner/actions/workflows/ci.yml/badge.svg?branch=main" alt="Build Status" /></a>
<a href="https://github.com/bluelibs/runner"><img src="https://img.shields.io/badge/coverage-100%25-brightgreen" alt="Coverage 100% is enforced" /></a>
<a href="https://bluelibs.github.io/runner/" target="_blank"><img src="https://img.shields.io/badge/read-typedocs-blue" alt="Docs" /></a>
<a href="https://www.npmjs.com/package/@bluelibs/runner"><img src="https://img.shields.io/npm/v/@bluelibs/runner.svg" alt="npm version" /></a>
<a href="https://www.npmjs.com/package/@bluelibs/runner"><img src="https://img.shields.io/npm/dm/@bluelibs/runner.svg" alt="npm downloads" /></a>
</p>

```typescript
import { r, run } from "@bluelibs/runner";

const userCreated = r
  .event<{ id: string; email: string }>("userCreated")
  .build();

const userStore = r
  .resource("userStore")
  .init(async () => new Map<string, { id: string; email: string }>())
  .build();

const createUser = r
  .task<{ email: string }>("createUser")
  .dependencies({ userStore, userCreated })
  .run(async (input, { userStore, userCreated }) => {
    const user = { id: "user-1", email: input.email };

    userStore.set(user.id, user);
    await userCreated(user);

    return user;
  })
  .build();

const sendWelcomeEmail = r
  .hook("sendWelcomeEmail")
  .on(userCreated)
  .run(async (event) => {
    console.log(`Welcome ${event.data.email}`);
  })
  .build();

const app = r
  .resource("app")
  .register([userStore, createUser, sendWelcomeEmail])
  .build();

const runtime = await run(app);
await runtime.runTask(createUser, { email: "ada@example.com" });
await runtime.dispose();
```

This example is intentionally runnable with only `@bluelibs/runner`, `typescript`, and `tsx`.

> **Note:** User-defined ids are local ids. Prefer `createUser`, `userStore`, and `sendWelcomeEmail`. Runner composes canonical ids such as `app.tasks.createUser` at runtime.

---

| Resource                                                                                                            | Type    | Description                         |
| ------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------- |
| [Official Website & Documentation](https://runner.bluelibs.com/)                                                    | Website | Overview and features               |
| [GitHub Repository](https://github.com/bluelibs/runner)                                                             | GitHub  | Source code, issues, and releases   |
| [Runner Dev Tools](https://github.com/bluelibs/runner-dev)                                                          | GitHub  | Development CLI and tooling         |
| [API Documentation](https://bluelibs.github.io/runner/)                                                             | Docs    | TypeDoc-generated reference         |
| [AI-Friendly Docs](./readmes/AI.md)                                                                                 | Docs    | Compact summary (<10,000 tokens)    |
| [Full Guide](./readmes/FULL_GUIDE.md)                                                                               | Docs    | Complete documentation (composed)   |
| [Support & Release Policy](./readmes/ENTERPRISE.md)                                                                 | Docs    | Support windows and deprecation     |
| [Design Documents](https://github.com/bluelibs/runner/tree/main/readmes)                                            | Docs    | Architecture notes and deep dives   |
| [Example: AWS Lambda Quickstart](https://github.com/bluelibs/runner/tree/main/examples/aws-lambda-quickstart)       | Example | API Gateway + Lambda integration    |
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
- **Need remote execution**: See [Remote Lanes](./readmes/REMOTE_LANES.md) (expose from Node.js, call from any `fetch` runtime)
- **Care about portability**: Read [Multi-Platform Architecture](./readmes/MULTI_PLATFORM.md)
- **Planning upgrades**: See [Support & Release Policy](./readmes/ENTERPRISE.md)
- **Want the complete guide**: Read [FULL_GUIDE.md](./readmes/FULL_GUIDE.md)
- **Want the short version**: Read [AI.md](./readmes/AI.md)

## Platform Support (Quick Summary)

| Capability                                             | Node.js | Browser | Edge | Notes                                                                                        |
| ------------------------------------------------------ | ------- | ------- | ---- | -------------------------------------------------------------------------------------------- |
| Core runtime (tasks/resources/middleware/events/hooks) | Full    | Full    | Full | Platform adapters hide runtime differences                                                   |
| Async Context (`r.asyncContext`)                       | Full    | None    | None | Requires `AsyncLocalStorage`; Bun/Deno may support it via the universal build when available |
| Durable workflows (`@bluelibs/runner/node`)            | Full    | None    | None | Node-only module                                                                             |
| Remote Lanes client (`createHttpClient`)               | Full    | Full    | Full | Explicit universal client for `fetch` runtimes                                               |
| Remote Lanes server (`@bluelibs/runner/node`)          | Full    | None    | None | Exposes tasks/events over HTTP                                                               |

---

## Prerequisites

Use these minimums before starting:

| Requirement     | Minimum                 | Notes                                                          |
| --------------- | ----------------------- | -------------------------------------------------------------- |
| Node.js         | `22.x+`                 | Enforced by `package.json#engines.node`                        |
| TypeScript      | `5.6+` (recommended)    | Required for typed DX and examples in this repository          |
| Package manager | npm / pnpm / yarn / bun | Examples use npm, but any modern package manager works         |
| `fetch` runtime | Built-in or polyfilled  | Required for explicit remote lane clients (`createHttpClient`) |

If you use the Node-only package (`@bluelibs/runner/node`) for durable workflows or exposure, stay on a supported Node LTS line.

---
