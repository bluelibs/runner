# BlueLibs Runner

### TypeScript-First Dependency Injection Framework

**Build enterprise applications that are maintainable, testable, and scalable**

Runner is a TypeScript-first framework for building applications from tasks (functions) and resources
(singletons), with explicit dependency injection, middleware, events, hooks, and lifecycle management.

For a token-friendly overview of the fluent builder API (`r.*`), see [AI.md](./AI.md).
Node-only features (durable workflows, tunnels) live under `@bluelibs/runner/node` and in `./readmes/`.

<p align="center">
<a href="https://github.com/bluelibs/runner/actions/workflows/ci.yml"><img src="https://github.com/bluelibs/runner/actions/workflows/ci.yml/badge.svg?branch=main" alt="Build Status" /></a>
<a href="https://github.com/bluelibs/runner"><img src="https://img.shields.io/badge/coverage-100%25-brightgreen" alt="Coverage 100% is enforced" /></a>
<a href="https://bluelibs.github.io/runner/" target="_blank"><img src="https://img.shields.io/badge/read-typedocs-blue" alt="Docs" /></a>
<a href="https://www.npmjs.com/package/@bluelibs/runner"><img src="https://img.shields.io/npm/v/@bluelibs/runner.svg" alt="npm version" /></a>
<a href="https://www.npmjs.com/package/@bluelibs/runner"><img src="https://img.shields.io/npm/dm/@bluelibs/runner.svg" alt="npm downloads" /></a>
</p>

```typescript
import { r, run } from "@bluelibs/runner";
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

// Define a task with dependencies, schema validation, and type-safe input/output
const createUser = r
  .task("users.create")
  .dependencies({ db, mailer })
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

**[Documentation](https://bluelibs.github.io/runner/)** · **[AI.md](./AI.md)** · **[Examples](https://github.com/bluelibs/runner/tree/main/examples)** · **[GitHub](https://github.com/bluelibs/runner)**

---

| Resource                                                                                                            | Type    | Description                         |
| ------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------- |
| [Presentation Website](https://runner.bluelibs.com/)                                                                | Website | Overview and features               |
| [GitHub Repository](https://github.com/bluelibs/runner)                                                             | GitHub  | Source code, issues, and releases   |
| [Runner Dev Tools](https://github.com/bluelibs/runner-dev)                                                          | GitHub  | Development CLI and tooling         |
| [API Documentation](https://bluelibs.github.io/runner/)                                                             | Docs    | TypeDoc-generated reference         |
| [AI-Friendly Docs](./AI.md)                                                                                         | Docs    | Compact summary (<5000 tokens)      |
| [Migration Guide (3.x → 4.x)](https://github.com/bluelibs/runner/blob/main/readmes/MIGRATION.md)                    | Guide   | Step-by-step upgrade instructions   |
| [Design Documents](https://github.com/bluelibs/runner/blob/main/readmes)                                            | Docs    | Architecture notes and deep dives   |
| [Example: Express + OpenAPI + SQLite](https://github.com/bluelibs/runner/tree/main/examples/express-openapi-sqlite) | Example | REST API with OpenAPI specification |
| [Example: Fastify + MikroORM + PostgreSQL](https://github.com/bluelibs/runner/tree/main/examples/fastify-mikroorm)  | Example | Full-stack application with ORM     |
| [AI Chatbot](https://chatgpt.com/g/g-68b756abec648191aa43eaa1ea7a7945-runner)                                       | Chatbot | Interactive Q&A assistant           |

### Community & Policies

- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)

---

## Why Runner?

<table>
<tr>
<td width="50%" valign="top">

### The Problem

Modern dependency injection frameworks force difficult trade-offs:

- **Magic-heavy** — Decorators, reflection, and runtime tricks make debugging painful
- **Boilerplate-heavy** — Manual wiring and factory patterns slow development
- **Steep learning curves** — Months to become productive

The result is code that's hard to test, hard to understand, and hard to maintain:

```typescript
@Injectable()
@Transactional()
@Cacheable({ ttl: 60 })
export class UserService {
  constructor(
    private readonly db: Database,
    private readonly cache: Cache,
    private readonly logger: Logger,
    // ... more dependencies
  ) {}
}
```

</td>
<td width="50%" valign="top">

### The Solution

Runner provides a functional, explicit approach:

```typescript
const createUser = r
  .task("users.create")
  .dependencies({ db, logger })
  .run(async (input, { db, logger }) => {
    const user = await db.users.insert(input);
    logger.info("User created", { userId: user.id });
    return user;
  })
  .build();

// Easy to test with mock dependencies
await createUser.run(mockInput, { db: mockDb, logger: mockLogger });
```

**Benefits:**

- **Zero magic** — Plain functions and objects
- **Full type safety** — TypeScript inference throughout
- **Simple testing** — Unit tests run in milliseconds
- **Clear debugging** — Readable stack traces
- **Gradual adoption** — Integrate into existing projects

</td>
</tr>
</table>

**Design principles:** Functions over classes · Explicit over implicit · Simple over clever

---

## Table of Contents

**Getting Started**

- [Why Runner?](#why-runner) - The problem we solve
- [What Is This Thing?](#what-is-this-thing)
- [When to Use Runner](#when-to-use-runner) - Is it right for you?
- [Show Me the Magic](#show-me-the-magic) - See it in action
- [How Does It Compare?](#how-does-it-compare) - vs. other frameworks
- [Performance at a Glance](#performance-at-a-glance) - Real benchmarks
- [What's in the Box?](#whats-in-the-box) - Feature matrix
- [Your First 5 Minutes](#your-first-5-minutes) - **Start here!**
- [Quick Start](#quick-start) - Full Express example
- [Learning Guide](#learning-guide) - Common patterns
- [Quick Wins](#quick-wins-copy-paste-solutions) - Copy-paste solutions
- [The Big Five](#the-big-five) - Core concepts

**Core Concepts**

- [Tasks](#tasks) - Functions with superpowers
- [Resources](#resources) - Singletons and lifecycle management
- [Events](#events) - Decoupled communication
- [Hooks](#hooks) - Lightweight event listeners
- [Middleware](#middleware) - Cross-cutting concerns
- [Tags](#tags) - Component discovery and configuration
- [Errors](#errors) - Typed error handling

**Runtime & Lifecycle**

- [run() and RunOptions](#run-and-runoptions) - Starting your application
- [Task Interceptors](#task-interceptors) - Advanced task control
- [Error Boundaries](#error-boundaries) - Fault isolation
- [Lifecycle Hooks](#lifecycle-hooks) - Graceful shutdown and cleanup

**Advanced Features**

- [Caching](#caching) - Built-in performance optimization
- [Retry](#retrying-failed-operations) - Resilience patterns
- [Timeouts](#timeouts) - Operation time limits
- [Logging](#logging) - Structured observability
- [Debug](#debug) - Development tooling

**Concurrency & Scheduling**

- [Semaphore](#semaphore) - Concurrency control
- [Queue](#queue) - Task scheduling

**Node-Specific Features** (see dedicated guides in `./readmes/`)

- [Durable Workflows](./readmes/DURABLE_WORKFLOWS.md) - Replay-safe, persistent workflows
- [HTTP Tunnels](./readmes/TUNNELS.md) - Remote task execution

**Architecture Patterns**

- [Optional Dependencies](#optional-dependencies) - Graceful degradation
- [Resource Forking](#resource-forking) - Multi-instance patterns
- [Serialization](#serialization) - Advanced data handling
- [Tunnels](#tunnels-bridging-runners) - Distributed systems
- [Async Context](#async-context) - Request-scoped state
- [Overrides](#overrides) - Component replacement
- [Namespacing](#namespacing) - Code organization
- [Factory Pattern](#factory-pattern) - Dynamic creation
- [Circular Dependencies](#handling-circular-dependencies) - Resolution strategies

**Developer Experience**

- [Quick Reference Cheat Sheet](#quick-reference-cheat-sheet) - **Bookmark this!**
- [Fluent Builders](#fluent-builders-r) - Ergonomic API
- [Type Helpers](#type-helpers) - TypeScript utilities
- [Runtime Validation](#runtime-validation) - Schema validation
- [Meta](#meta) - Component documentation
- [Testing](#testing) - Unit and integration patterns

**Reference**

- [Real-World Example](#real-world-example-the-complete-package) - Complete application
- [Internal Services](#internal-services) - Framework internals
- [Performance](#performance) - Benchmarks and metrics
- [Why Choose BlueLibs Runner?](#why-choose-bluelibs-runner) - Framework comparison
- [Migration Path](#the-migration-path) - Adopting Runner
- [Troubleshooting](#troubleshooting) - Common issues and solutions
- [Under the Hood](#under-the-hood) - Architecture deep dive
- [Integration Recipes](#integration-recipes) - Docker, k8s, observability
- [Community & Support](#community--support) - Getting help

---
