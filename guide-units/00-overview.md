← [Back to main README](../README.md)

---

## Why Runner?

Modern applications are complex. They integrate with multiple services, have many moving parts, and need to be resilient, testable, and maintainable. Traditional frameworks often rely on reflection, magic, or heavy abstractions that obscure the flow of data and control. This leads to brittle systems that are hard to debug and evolve.

### Functional Composition with Clarity

Runner keeps everything as plain functions and objects. You declare dependencies up front, wire them once, and get predictable runtime behavior with no hidden reflection.

```typescript
import { r, run, globals } from "@bluelibs/runner";
const logger = globals.resources.logger;

// resources are singletons with lifecycle management
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

// events are signals that something happened, often used for decoupling
const userCreated = r
  .event("users.created")
  .payloadSchema(z.object({ userId: z.string() })) // runtime and compile-time validation
  .build();

// notifications module
const onUserCreatedHook = r
  .hook("users.welcomeEmail")
  .on(userCreated)
  .dependencies({ mailer, logger })
  .run(async (event, { mailer, logger }) => {
    await mailer.sendWelcome(event.userId);
    logger.info("Welcome email sent", { userId: event.userId });
  })
  .build();

// tasks are functions with explicit dependencies and input/output schemas
const createUser = r
  .task("users.create")
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
  .register([db, userCreated, createUser, onUserCreatedHook]) // lets the runtime know about it
  .build(); // close the builder

const { runTask, emitEvent, dispose } = await run(app);
```

Any resource can be 'run' independently, giving you incredible freedom of testing and composition. Stay tuned because we have lots of goodies.

**Benefits:**

- **Explicit wiring** — Dependencies are declared in code, not discovered at runtime
- **Type-driven** — TypeScript inference flows through tasks, resources, and middleware
- **Testable by default** — Call `.run()` with mocks or run the full app, no special harnesses
- **Traceable** — Stack traces and debug output stay aligned with your source
- **Incremental adoption** — Wrap an existing service or task without rewriting the rest

---

## Table of Contents

**Getting Started**

- [Why Runner?](#why-runner) - The problem we solve
- [What Is This Thing?](#what-is-this-thing)
- [When to Use Runner](#when-to-use-runner) - Is it right for you?
- [Show me the wiring](#show-me-the-wiring) - See it in action
- [How Does It Compare?](#how-does-it-compare) - vs. other frameworks
- [Performance at a Glance](#performance-at-a-glance) - Real benchmarks
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
