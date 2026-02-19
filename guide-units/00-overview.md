## Why Runner?

Modern applications are complex. They integrate with multiple services, have many moving parts, and need to be resilient, testable, and maintainable. Traditional frameworks often rely on reflection, magic, or heavy abstractions that obscure the flow of data and control. This leads to brittle systems that are hard to debug and evolve.

### Functional Composition with Clarity

Runner keeps everything as plain functions and objects. You declare dependencies up front, wire them once, and get predictable runtime behavior with no hidden reflection.

```typescript
import { r, run, globals } from "@bluelibs/runner";
import { z } from "zod";

const logger = globals.resources.logger;

// resources are singletons with lifecycle management and async construction
const db = r
  .resource("app.db")
  .init(async () => {
    const conn = await postgres.connect(process.env.DB_URL);
    return conn;
  })
  .build();

const mailer = r
  .resource("app.mailer")
  .dependencies({ logger })
  .init(async (_config, { logger }) => ({
    sendWelcome: async (userId: string) => {
      logger.info("Sending welcome email", { userId });
    },
  }))
  .build();

// events are signals that something happened, often used for decoupling
const userCreated = r
  .event("app.events.userCreated")
  .payloadSchema(z.object({ userId: z.string() })) // runtime and compile-time validation
  .build();

// notifications module
const onUserCreatedHook = r
  .hook("app.hooks.onUserCreated")
  .on(userCreated)
  .dependencies({ mailer, logger })
  .run(async (event, { mailer, logger }) => {
    await mailer.sendWelcome(event.data.userId);
    logger.info("Welcome email sent", { userId: event.data.userId });
  })
  .build();

// tasks are functions with explicit dependencies and input/output schemas
const createUser = r
  .task("app.tasks.createUser")
  .dependencies({ db, logger, emitUserCreated: userCreated })
  .inputSchema(z.object({ name: z.string(), email: z.string().email() }))
  .run(async (user, { db, logger, emitUserCreated }) => {
    const createdUser = await db.users.insert(user);
    await emitUserCreated({ userId: createdUser.id });
    logger.info("User created", { userId: createdUser.id });

    return createdUser;
  })
  .build();

// wire everything into the app resource
const app = r
  .resource("app")
  .register([db, mailer, userCreated, createUser, onUserCreatedHook]) // lets the runtime know about it
  .build(); // close the builder

const { runTask, emitEvent, dispose } = await run(app);
```

Any resource can be 'run' independently, giving you incredible freedom of testing and composition. Stay tuned because we have lots of goodies.

**Benefits:**

- **Explicit wiring** — Dependencies are declared in code, not discovered at runtime
- **Architectural isolation** — Use resource `.exports([...])` to keep domain internals private and expose only stable contracts
- **Type-driven** — TypeScript inference flows through tasks, resources, and middleware
- **Testable by default** — Call `.run()` with mocks or run the full app, no special harnesses
- **Traceable** — Stack traces and debug output stay aligned with your source
- **Incremental adoption** — Wrap an existing service or task without rewriting the rest

---

## Table of Contents

**Getting Started**

- [Prerequisites](#prerequisites) - Runtime/tooling requirements
- [Why Runner?](#why-runner) - The problem we solve
- [What Is This Thing?](#what-is-this-thing)
- [When to Use Runner](#when-to-use-runner) - Is it right for you?
- [Show Me the Wiring](#show-me-the-wiring) - See it in action
- [How Does It Compare?](#how-does-it-compare) - vs. other frameworks
- [What's in the Box?](#whats-in-the-box) - Feature matrix
- [Your First 5 Minutes](#your-first-5-minutes) - **Start here!**
- [Quick Start](#quick-start) - Full Express example
- [Learning Guide](#learning-guide) - Common patterns
- [Quick Wins](#quick-wins-copy-paste-solutions) - Copy-paste solutions
- [The Big Five](#the-big-five) - Core concepts

**Core Concepts**

- [Tasks](#tasks) - Functions with dependency injection and middleware
- [Resources](#resources) - Singletons and lifecycle management
- [Events](#events) - Decoupled communication
- [Hooks](#hooks) - Lightweight event subscribers
- [Middleware](#middleware) - Cross-cutting concerns
- [Tags](#tags) - Component discovery and configuration
- [Errors](#errors) - Typed error handling

**Runtime & Lifecycle**

- [run() and RunOptions](#run-and-runoptions) - Starting your application
- [Task Interceptors](#task-interceptors) - Advanced task control
- [Error Boundaries](#error-boundary-integration) - Fault isolation
- [Lifecycle Management](#lifecycle-management) - Graceful shutdown and cleanup

**Advanced Features**

- [Caching](#caching) - Built-in performance optimization
- [Retry](#retrying-failed-operations) - Resilience patterns
- [Timeouts](#timeouts) - Operation time limits
- [Logging](#logging) - Structured observability
- [Observability Strategy](#observability-strategy-logs-metrics-and-traces) - Signals and alerting baseline
- [Debug](#debug-resource) - Development tooling

**Concurrency & Scheduling**

- [Semaphore](#semaphore) - Concurrency control
- [Queue](#queue) - Task scheduling

**Deployment & Integrations** (see dedicated guides in this folder)

- [Durable Workflows](./readmes/DURABLE_WORKFLOWS.md) - Replay-safe, persistent workflows (Node-only)
- [HTTP Tunnels](./readmes/TUNNELS.md) - Expose tasks/events over HTTP (server: Node, client: any `fetch` runtime)
- [Multi-Platform Architecture](./readmes/MULTI_PLATFORM.md) - How Runner supports Node, browsers, and edge runtimes

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
- [Runner Dev Tools Quick Start](#runner-dev-tools-quick-start) - CLI and runtime introspection
- [Type Helpers](#type-helpers) - TypeScript utilities
- [Runtime Validation](#runtime-validation) - Schema validation
- [Meta](#meta) - Component documentation
- [Testing](#testing) - Unit and integration patterns

**Reference**

- [Real-World Example](#real-world-example-the-complete-package) - Complete application
- [Internal Services](#internal-services) - Framework internals
- [Why Choose BlueLibs Runner?](#why-choose-bluelibs-runner) - Framework comparison
- [Migration Path](#the-migration-path) - Adopting Runner
- [Release, Support, and Deprecation Policy](#release-support-and-deprecation-policy) - Upgrade governance
- [Production Readiness Checklist](#production-readiness-checklist) - Framework-wide deploy checks
- [Node API Index](#node-api-index) - Node-only exports at a glance
- [Troubleshooting](#troubleshooting) - Common issues and solutions
- [Under the Hood](#under-the-hood) - Architecture deep dive
- [Integration Recipes](#integration-recipes) - Docker, k8s, observability
- [Community & Support](#community--support) - Getting help
