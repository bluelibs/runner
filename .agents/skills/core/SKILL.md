---
name: Runner Developer
description: Primary skill for working with the BlueLibs Runner Framework. Use it for general Runner questions, framework implementation work, and Runner-specific topics such as resources, tasks, events and hooks, middleware, tags, runtime lifecycle, serialization and validation, observability, testing, Remote Lanes (RPC and Events), and Durable Workflows.
---

# Runner

Start with `./references/readmes/COMPACT_GUIDE.md`. It is the fast path for Runner's core mental model, public API shape, and common contracts.

# BlueLibs Runner: Ultra Compact Guide

## The Vibe

Runner is a contract-first composition engine.
You define a typed graph of `resources`, `tasks`, `events`, `hooks`, `middleware`, `tags`, and `errors`.
Then `run(app)` compiles that graph into a runtime that enforces behavior, isolation, lifecycle, and observability.

The first mental flip:

- You describe architecture first (`*.build()`), and execution comes only after `run()`.
- Bad wiring is usually a boot-time failure, not a runtime surprise.

## Core Primitives

- `resource`: lifecycle owner for shared state and service boundaries.
- `task`: typed business action with DI, middleware, validation, and typed output.
- `error`: typed domain failure contract.
- `event` + `hook`: explicit publish-and-react model.
- `middleware`: cross-cutting policy layer (identity, retries, timeout, caching, etc.).
- `tag`: typed metadata for discovery and policy attachment.

## What Runner Changes for You

- Builder declarations are explicit and fail fast when composition is invalid.
- `localId` is your design language; canonical IDs are Runner’s runtime addressing.
- `run(app)` gives a stable runtime surface: `runTask`, `emitEvent`, `getHealth`, `dispose`, and mode/state.
- Runtime lifecycle is intentional: `init → ready → running → cooldown → disposing`.
- `cooldown()` stops accepting new external work; `dispose()` is final teardown.

## Composition Is Real, Not Cosmetic

`isolate` and subtree policies make boundaries enforceable.
You can define what a subtree exports, what it may depend on, and what is hidden by default.

`local` IDs are how teams think; canonical IDs are how the framework enforces ownership and visibility.

## Context and Contract

Runner splits context cleanly:

- `executionContext` for runtime tracing and cancellation.
- `asyncContext` for business/request state (tenant, user, identity, locale).

When this split is in place, observability and policy are easier to reason about.

## Testing and Safe Evolution

Most teams evolve Runner systems with:

- a minimal root resource for tests,
- `run(...)`,
- `r.override(...)` for targeted behavior swaps.

This keeps behavior and contract changes isolated while preserving ids and topology.

## Core Docs

Use `./references/guide-units/` for the structured framework chapters.
Use this exact mapping (file -> concern):

- `./references/guide-units/02-resources.md` → `resources` (`state`, `lifecycle`, `ownership`, `health`)
- `./references/guide-units/02b-tasks.md` → `tasks` (`typed IO`, `DI`, `runtime execution`, `cancellation`)
- `./references/guide-units/02c-events-and-hooks.md` → `events` and `hooks` (`publish`, `subscribe`, `transaction`, `ordering`)
- `./references/guide-units/02d-middleware.md` → `middleware` (`cross-cutting`, `retry`, `timeout`, `rate/queue control`, `ratelimit`, `caching`, `identity`)
- `./references/guide-units/02e-tags.md` → `tags` (`metadata`, `discovery`, `discovery policy`, `contracts`)
- `./references/guide-units/02f-errors.md` → `errors` (`typed domain errors`, `structured data`, `remediation`)
- `./references/guide-units/03-runtime-lifecycle.md` → `runtime lifecycle` (`boot`, `ready`, `cooldown`, `shutdown`)
- `./references/guide-units/04-features.md` → `features` (`HTTP shutdown`, `signal propagation`, `executionContext`, `runtime behavior patterns`)
- `./references/guide-units/04b-serialization-validation.md` → `serialization` and `validation` (`schema contracts`, `boundary safety`, `custom types`)
- `./references/guide-units/04c-security.md` → `security` (`identity`, `access gates`, `scope`, `tenant/user partitioning`)
- `./references/guide-units/05-observability.md` → `observability` (`logs`, `metrics`, `traces`, `health`)
- `./references/guide-units/06-meta-and-internals.md` → `meta` and `internals` (`docs`, `canonical ids`, `runtime services`)
- `./references/guide-units/08-testing.md` → `testing` (`unit`, `focused integration`, `full integration`)

For documentation authoring or guide composition, also read:

- `./references/guide-units/DOCS_STYLE_GUIDE.md`
- `./references/guide-units/INDEX_GUIDE.md`
- `./references/guide-units/INDEX_README.md`

## Topic Docs

Use `./references/readmes/` for task-specific references and alternate viewpoints.
Available docs include:

- `COMPACT_GUIDE.md`
- `MULTI_PLATFORM.md`
- `DURABLE_WORKFLOWS.md`
- `DURABLE_WORKFLOWS_AI.md`
- `REMOTE_LANES.md`
- `REMOTE_LANES_AI.md`
- `REMOTE_LANES_HTTP_POLICY.md`
- `SERIALIZER_PROTOCOL.md`
- `OOP.md`
- `FUNCTIONAL.md`
- `FLUENT_BUILDERS.md`
- `COMPARISON.md`
- `ENTERPRISE.md`
- `BENCHMARKS.md`
- `CRITICAL_THINKING.md`

Read only the files that match the task.

## Snippets

Use `./references/snippets/` when the task matches a common Runner authoring shape and a canonical starting point is better than inventing one from scratch.

- `app-basic.snippet` for the smallest complete app shell
- `task-basic.snippet` for a normal runtime-backed task with DI and schemas
- `task-resilient.snippet` for retry, timeout, health-gating, metadata, and cancellation-aware task design
- `resource-service.snippet` for a long-lived dependency value with `init(...)` and `dispose(...)`
- `resource-complex.snippet` for typed config, child registration, context, health, and full lifecycle ownership
- `resource-isolate-subtree-identity.snippet` for exported surface control plus subtree identity and middleware policy
- `security-identity-layering.snippet` for explicit `identityChecker`, middleware `identityScope`, and subtree task identity gates
- `event-hook-pipeline.snippet` for exact-event emission plus hook reaction
- `event-hook-transactional.snippet` for reversible transactional hooks with undo closures
- `middleware-task.snippet` for a canonical task middleware wrapper
- `tag-contract.snippet` for target-scoped tags with config schema and compile-time contracts
- `test-runtime-task.snippet` for a runtime-backed task integration test

Prefer these snippets for starter shapes before writing custom examples.
They are builder-first, use local ids, and aim to be runtime-complete rather than half-finished pseudocode.

## Durable Workflows

- Read `./references/readmes/COMPACT_GUIDE.md` first.
- `./references/readmes/DURABLE_WORKFLOWS.md` for the main guide and canonical examples.
- `./references/readmes/DURABLE_WORKFLOWS_AI.md` for the shorter token-friendly field guide.

## Remote Lanes

- Read `./references/readmes/COMPACT_GUIDE.md` first.
- `./references/readmes/REMOTE_LANES.md` for the main guide and canonical examples.
- `./references/readmes/REMOTE_LANES_AI.md` for the compact AI field guide when you need a faster refresher.
- `./references/readmes/REMOTE_LANES_HTTP_POLICY.md` only when the task is specifically about HTTP transport policy.
