---
name: runner-durable-workflow-specialist
description: Specialized guidance for using Runner Durable Workflows in applications. Use when Codex needs to design replay-safe workflows, choose durable resources or backends, model `step`/`sleep`/`waitForSignal` flows, wire workflow start and signal entry points, handle recovery, scheduling, rollback, or audit inspection, or debug replay and persistence behavior in Runner Durable Workflows.
---

# Runner Durable Workflow Specialist

Use this skill for application-level Durable Workflow work.
This is about building with durable workflows, not changing the workflow engine internals.

## Start Here

Read in this order:

- `./references/DURABLE_WORKFLOWS.md` for the main guide and canonical examples.
- `./references/DURABLE_WORKFLOWS_AI.md` for the shorter token-friendly field guide.
- `../../../readmes/MULTI_PLATFORM.md` when platform assumptions matter, because durable workflows are Node-only.

Keep the core mental model front and center:

- a workflow does not resume the instruction pointer
- it re-runs from the top and reuses persisted step results
- side effects belong inside `durableContext.step(...)`

## Design The Workflow From Checkpoints

Start from the workflow contract before writing code:

1. Identify the long-running business flow.
2. Decide which moments must survive restarts, deploys, or worker moves.
3. Turn those moments into durable checkpoints:
   - `step(...)`
   - `sleep(...)`
   - `waitForSignal(...)`
4. Decide how the workflow starts:
   - `start(...)`
   - `startAndWait(...)`
5. Decide how outside systems interact later:
   - signals
   - schedules
   - operator/store inspection

Stable step ids are part of the workflow contract.
If a task includes side effects outside durable steps, treat that as a bug until proven otherwise.

## Wire Durable Resources Correctly

Build from the supported Runner pattern:

- register `resources.durable` once for tags and durable events
- fork a concrete backend such as `resources.memoryWorkflow` or `resources.redisWorkflow`
- inject the durable resource and call `durable.use()` inside the workflow task
- tag workflow tasks with `tags.durableWorkflow`

Prefer:

- `memoryWorkflow` for local development and tests
- `redisWorkflow` when the workflow must survive real process boundaries and production restarts

Keep starter tasks, routes, or handlers separate from the durable workflow task itself.
Start workflows explicitly through the durable service instead of exposing the workflow body as an ordinary remote task entry point.

## Keep Replay Safety Honest

When implementing or reviewing durable logic:

- put external side effects inside `durableContext.step(...)`
- keep step ids stable and descriptive
- use explicit `stepId` options for production-facing sleeps, emits, and signal waits when needed
- use `durableContext.switch(...)` for replay-safe branching when the flow shape matters
- model compensation deliberately with `up(...)`, `down(...)`, and `rollback()`

Common smell:

- using plain mutable local flow assumptions as if the instruction pointer resumes where it left off

## Signals, Scheduling, And Recovery

Be explicit about how the workflow moves through time:

- use signals for external approvals or domain events
- use sleep for time-based waiting
- use schedules for delayed or recurring durable starts
- use recovery on startup when incomplete executions must resume

When a task asks for observability or support tooling, prefer:

- `store.getExecution(...)`
- durable operator helpers when available
- audit entries and durable events for timeline visibility

## Local Development And Testing

In tests:

- build the smallest app that expresses the workflow contract
- assert replay-safe behavior, not only happy-path completion
- test signal delivery, timeout behavior, recovery, and rollback when relevant
- prefer local durable backends first, then broader integration only when the transport or persistence layer is the actual subject

When debugging, check these first:

- missing `tags.durableWorkflow`
- workflow started through the wrong surface
- side effects outside `step(...)`
- unstable or changed step ids
- missing polling or recovery expectations
- confusion between workflow result state and current execution detail in the store

## Finish Cleanly

Before finishing:

- confirm every side effect sits behind a durable checkpoint
- confirm workflow entry and signal paths are explicit
- confirm the selected backend matches the runtime environment
- run focused tests first, then `npm run qa`
