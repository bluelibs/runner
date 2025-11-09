<div align="center">

```
██████╗ ██╗     ██╗   ██╗███████╗██╗     ██╗██████╗ ███████╗
██╔══██╗██║     ██║   ██║██╔════╝██║     ██║██╔══██╗██╔════╝
██████╔╝██║     ██║   ██║█████╗  ██║     ██║██████╔╝███████╗
██╔══██╗██║     ██║   ██║██╔══╝  ██║     ██║██╔══██╗╚════██║
██████╔╝███████╗╚██████╔╝███████╗███████╗██║██████╔╝███████║
╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝╚══════╝╚═╝╚═════╝ ╚══════╝
██████╗ ██╗   ██╗███╗   ███╗███╗   ██╗███████╗██████╗
██╔══██╗██║   ██║████╗ ████║████╗  ██║██╔════╝██╔══██╗
██████╔╝██║   ██║██╔████╔██║██╔██╗ ██║█████╗  ██████╔╝
██╔══██╗██║   ██║██║╚██╔╝██║██║╚██╗██║██╔══╝  ██╔══██╗
██║  ██║╚██████╔╝██║ ╚═╝ ██║██║ ╚████║███████╗██║  ██║
╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝
```

### _TypeScript-First Dependency Injection That Doesn't Suck_ ⚡

**Build enterprise apps that are actually maintainable**

<p align="center">
<a href="https://github.com/bluelibs/runner/actions/workflows/ci.yml"><img src="https://github.com/bluelibs/runner/actions/workflows/ci.yml/badge.svg?branch=main" alt="Build Status" /></a>
<a href="https://github.com/bluelibs/runner"><img src="https://img.shields.io/badge/coverage-100%25-brightgreen" alt="Coverage 100% is enforced" /></a>
<a href="https://bluelibs.github.io/runner/" target="_blank"><img src="https://img.shields.io/badge/read-typedocs-blue" alt="Docs" /></a>
<a href="https://www.npmjs.com/package/@bluelibs/runner"><img src="https://img.shields.io/npm/v/@bluelibs/runner.svg" alt="npm version" /></a>
<a href="https://www.npmjs.com/package/@bluelibs/runner"><img src="https://img.shields.io/npm/dm/@bluelibs/runner.svg" alt="npm downloads" /></a>
</p>

```typescript
// This is all you need to build production-ready apps
import { r, run } from "@bluelibs/runner";

const app = r.resource("app").register([yourTasks, yourServices]).build();
await run(app); // 🚀 That's it. Type-safe, testable, scalable.
```

**[📚 Read the Docs](https://bluelibs.github.io/runner/)** · **[🎮 Try the Examples](./examples)** · **[💬 Join Discord](#community--support)** · **[⭐ Star on GitHub](https://github.com/bluelibs/runner)**

</div>

---

| Resource                                                                                                            | Type    | Notes                                                         |
| ------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------- |
| [Presentation Website](https://runner.bluelibs.com/)                                                                | Website | Overview, features, and highlights                            |
| [BlueLibs Runner GitHub](https://github.com/bluelibs/runner)                                                        | GitHub  | Source code, issues, and releases                             |
| [BlueLibs Runner Dev](https://github.com/bluelibs/runner-dev)                                                       | GitHub  | Development tools and CLI for BlueLibs Runner                 |
| [UX Friendly Docs](https://bluelibs.github.io/runner/)                                                              | Docs    | Clean, navigable documentation                                |
| [AI Friendly Docs (<5000 tokens)](https://github.com/bluelibs/runner/blob/main/AI.md)                               | Docs    | Short, token-friendly summary (<5000 tokens)                  |
| [Migrate from 3.x.x to 4.x.x](https://github.com/bluelibs/runner/blob/main/readmes/MIGRATION.md)                    | Guide   | Step-by-step upgrade from v3 to v4                            |
| [Runner Lore](https://github.com/bluelibs/runner/blob/main/readmes)                                                 | Docs    | Design notes, deep dives, and context                         |
| [Example: Express + OpenAPI + SQLite](https://github.com/bluelibs/runner/tree/main/examples/express-openapi-sqlite) | Example | Full Express + OpenAPI + SQLite demo                          |
| [Example: Fastify + MikroORM + PostgreSQL](https://github.com/bluelibs/runner/tree/main/examples/fastify-mikroorm)  | Example | Full Fastify + MikroORM + PostgreSQL demo                     |
| [OpenAI Runner Chatbot](https://chatgpt.com/g/g-68b756abec648191aa43eaa1ea7a7945-runner?model=gpt-5-thinking)       | Chatbot | Ask questions interactively, or feed README.md to your own AI |

### Community & Policies

- Code of Conduct: see [CODE_OF_CONDUCT](./CODE_OF_CONDUCT.md)
- Contributing: see [CONTRIBUTING](./CONTRIBUTING.md)
- Security: see [SECURITY](./SECURITY.md)

---

## 🎯 Why This Exists

<table>
<tr>
<td width="50%">

### ❌ The Problem

You've been there. It's 2 AM, you're debugging why your "simple" dependency injection isn't working, and you're questioning every life choice that led you here.

**Modern frameworks force you to choose:**

- 🪄 **Magic** (decorators, reflection, runtime tricks) → Impossible to debug
- 🏗️ **Boilerplate** (manual wiring, factories) → Death by a thousand constructors
- 📚 **Complexity** (learning curves steeper than Everest) → 6 months to productivity

Your codebase becomes:

```typescript
// 3 months later...
@Injectable()
@Transactional()
@Cacheable({ ttl: 60 })
export class WhatDoesThisEvenDo {
  constructor(
    private readonly dep1,
    private readonly dep2,
    private readonly dep3,
  ) // ... 12 more dependencies
  {} // Good luck testing this
}
```

</td>
<td width="50%">

### ✅ The Solution

**Runner gives you superpowers without the headaches:**

```typescript
// Clear, explicit, testable
const createUser = r
  .task("users.create")
  .dependencies({ db, emailer })
  .run(async (input, { db, emailer }) => {
    const user = await db.insert(input);
    await emailer.send(user.email);
    return user;
  })
  .build();

// Test it easily
await createUser.run(
  { email: "test@example.com" },
  { db: mockDb, emailer: mockEmailer },
);
```

**What you get:**

- ⚡ **Zero magic** - It's just functions and objects
- 🎯 **Type-safe** - TypeScript knows everything
- 🧪 **Testable** - Unit test in milliseconds
- 📈 **Scalable** - From hobby project to enterprise
- 🔍 **Debuggable** - Stack traces make sense
- 💪 **Productive** - Build features, not infrastructure

</td>
</tr>
</table>

**The philosophy:** Functions > Classes · Explicit > Implicit · Simple > Clever

---

## 👋 Welcome!

Hey there! If you've ever felt like modern frameworks make simple things complicated, you're in the right place. We built Runner because we believe **building apps should be enjoyable**, not exhausting.

Think of Runner as your thoughtful coding companion. It handles the boring stuff (dependency injection, lifecycle management, error handling) so you can focus on building features your users actually care about.

---

## Table of Contents

**Getting Started**

- [🎯 Why This Exists](#-why-this-exists) - The problem we solve
- [What Is This Thing?](#what-is-this-thing)
- [🔥 Show Me the Magic](#-show-me-the-magic) - See it in action
- [📊 How Does It Compare?](#-how-does-it-compare) - vs. other frameworks
- [⚡ Performance at a Glance](#-performance-at-a-glance) - Real benchmarks
- [🎁 What's in the Box?](#-whats-in-the-box) - Feature matrix
- [Your First 5 Minutes](#your-first-5-minutes) - 🚀 **Start here!**
- [Quick Start](#quick-start) - Full Express example
- [Learning Guide](#learning-guide-common-patterns) - 💡 Common patterns
- [🎯 Quick Wins](#-quick-wins-copy-paste-solutions) - 5 copy-paste solutions
- [The Big Five](#the-big-five) - Core concepts

**Core Concepts**

- [Tasks](#tasks) - Functions with superpowers
- [Resources](#resources) - Singletons and lifecycle management
- [Events](#events) - Decoupled communication
- [Hooks](#hooks) - Lightweight event listeners
- [Middleware](#middleware) - Cross-cutting concerns
- [Tags](#tags) - Component discovery and configuration
- [Errors](#errors) - Typed error handling

**Runtime & Execution**

- [run() and RunOptions](#run-and-runoptions) - Starting your application
- [Task Interceptors](#task-interceptors) - Advanced task control
- [Error Boundaries](#error-boundaries) - Fault isolation

**Advanced Features**

- [Caching](#caching) - Built-in performance optimization
- [Retry](#retrying-failed-operations) - Resilience patterns
- [Timeouts](#timeouts) - Operation time limits
- [Logging](#logging) - Structured observability
- [Debug](#debug) - Development tooling
- [Semaphore](#semaphore) - Concurrency control
- [Queue](#queue) - Task scheduling

**Architecture Patterns**

- [Optional Dependencies](#optional-dependencies) - Graceful degradation
- [Serialization (EJSON)](#serialization-ejson) - Advanced data handling
- [Tunnels](#tunnels-bridging-runners) - Distributed systems
- [Async Context](#async-context) - Request-scoped state
- [Overrides](#overrides) - Component replacement
- [Namespacing](#namespacing) - Code organization
- [Factory Pattern](#factory-pattern) - Dynamic creation
- [Circular Dependencies](#handling-circular-dependencies) - Resolution strategies

**Developer Experience**

- [📚 Quick Reference Cheat Sheet](#-quick-reference-cheat-sheet) - 🔖 **Bookmark this!**
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
- [Community & Support](#community--support) - Getting help

---

