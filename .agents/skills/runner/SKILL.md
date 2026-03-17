---
name: runner
description: Main skill for building applications with BlueLibs Runner. Use when Codex needs help modeling resources, tasks, events, hooks, middleware, tags, errors, runtime lifecycle, validation, observability, or testing in apps built with Runner, and when it should navigate Runner documentation from the compact guide into the correct in-depth guide chapter.
---

# Runner

Start with `./references/COMPACT_GUIDE.md`.
It is the fast path for Runner's core mental model, public API shape, and common contracts.

When the task needs deeper documentation, open the matching chapter from `./references/guide-units/`:

- `02-resources.md` for resources, app composition, ownership, boundaries, exports, subtree policy, and overrides
- `02b-tasks.md` for tasks, schemas, dependencies, result validation, and execution patterns
- `02c-events-and-hooks.md` for events, hooks, event payload contracts, and decoupled flow design
- `02d-middleware.md` for task/resource middleware and cross-cutting behavior
- `02e-tags.md` for tags, discovery, and policy-style metadata
- `02f-errors.md` for typed Runner errors and `.throws(...)`
- `03-runtime-lifecycle.md` for `run(...)`, startup, shutdown, pause/resume, and run options
- `04-features.md` for advanced built-in features such as HTTP shutdown patterns, execution context and signal propagation, cron scheduling, semaphores, and queue/semaphore utilities
- `04b-serialization-validation.md` for serialization, validation, DTO boundaries, and trust-boundary parsing
- `04c-multi-tenant.md` for tenant-aware execution and isolation patterns
- `05-observability.md` for logs, metrics, traces, and health strategy
- `06-meta-and-internals.md` for `meta(...)`, canonical ids and namespacing, and built-in internal services such as `resources.runtime`, `resources.store`, and `resources.taskRunner`
- `08-testing.md` for unit, focused integration, and full integration testing

When the task is about documentation authoring or guide composition itself, also read:

- `DOCS_STYLE_GUIDE.md`
- `INDEX_GUIDE.md`
- `INDEX_README.md`

Use the more specialized skills when the task leaves general Runner app usage:

- use `runner-remote-lanes-specialist` for Remote Lanes work
- use `runner-durable-workflow-specialist` for Durable Workflows work
- use `runner-architect` for Runner framework internals, public architecture, or design changes
