---
name: runner-architect
description: Design and review BlueLibs Runner itself at the framework architecture level. Use when Codex needs to shape or critique Runner public contracts, builder APIs, runtime lifecycle, isolation boundaries, overrides, subtree policy, multi-platform behavior, documentation strategy, or test strategy for changes inside the Runner codebase rather than applications built with Runner.
---

# Runner Architect

Design Runner changes from contracts outward.
Treat this skill as the architecture counterpart to the existing `runner` skill: use it for shaping the framework, not for building an app with the framework.
Treat this skill as Runner-repo-only: it is meant to operate inside the BlueLibs Runner repository, not as a generic framework architecture skill.

## Runner Repo Context

Runner is a strongly typed composition framework built as a graph of explicit definitions.
Keep that mental model loaded while you work:

- contracts are explicit and enforced at runtime
- the main primitives are `resource`, `task`, `event`, `hook`, and `middleware`
- startup flows `init -> ready` in dependency order
- shutdown flows `cooldown -> dispose` in reverse dependency order
- boundary, schema, and dependency-cycle mistakes should fail fast during bootstrap
- the core is multi-platform through platform adapters; Node-specific capabilities stay isolated
- nested resources define ownership boundaries and canonical ids
- parallel `run(app)` containers must remain fully isolated
- builder APIs are immutable generic chains that become definitions on `.build()`
- runtime admission control is part of the design story, including `pause()`, `resume()`, and recovery behavior

Use the repo structure deliberately:

- `src/definers/` and `src/definers/builders/` shape the public fluent API and generic accumulation
- `src/models/` contains runtime behavior, middleware composition, event execution, lifecycle control, dependency processing, and registries
- `src/types/` is the contract layer for definitions and type relationships
- `src/globals/` contains built-in middleware, resources, and shared primitives
- `src/platform/adapters/` holds the platform boundary for shared runtime behavior
- `src/node/` is strictly for Node-only features such as durable workflows, exposure, and lanes
- `src/__tests__/` mirrors the source layout and is the best place to inspect existing architectural examples
- `readmes/` and `guide-units/` feed the composed docs; `FULL_GUIDE.md` is generated and should not be edited directly

## Work From Contracts First

Start by writing down the contract change before touching implementation:

- Define the user-facing capability or constraint.
- Define which Runner primitive should own it: `resource`, `task`, `event`, `hook`, `middleware`, `tag`, `error`, or runtime API.
- Define the trust boundary and runtime boundary.
- Define whether the change is cross-platform or Node-only.
- Define the acceptance criteria for behavior, typing, docs, and tests.

If the request is architecture-heavy, present a short design before large edits:

- public surface
- ownership model
- lifecycle/isolation impact
- migration or compatibility impact
- tests and docs impact

## Choose The Right Runner Primitive

Map the feature to Runner's building blocks deliberately:

- Use a `resource` when the feature owns lifecycle, registration, boundaries, config, or shared state.
- Use a `task` when the feature is a typed business action or operator entry point.
- Use an `event` plus `hook` when you want explicit fan-out or decoupled reactions.
- Use `middleware` when the behavior must wrap execution across many tasks or resources.
- Use a `tag` when the goal is discovery, policy, or typed grouping without manual registries.
- Use a Runner `error` helper when exposing a reusable failure contract.

Prefer resource subtrees over flat registration when the feature introduces ownership or policy boundaries.

## Keep Architecture Honest

Design with these Runner rules in mind:

- Treat resources as the primary ownership and composition unit.
- Prefer local ids; let Runner compose canonical ids from ownership.
- Fail fast during bootstrap when the graph is invalid instead of delaying failure to runtime use.
- Use `.isolate(...)` for exported surfaces and cross-boundary rules.
- Use `.subtree(...)` for subtree-wide middleware and validation policy.
- Use `r.override(...)` only for behavior replacement, not structural redesign.
- Preserve isolation between parallel `run(app)` executions.

When a feature changes lifecycle, boundary wiring, or startup behavior, verify how it behaves during:

- bootstrap
- lazy initialization
- pause/resume
- graceful disposal
- forced disposal

## Keep Multi-Platform Honest

Runner is multi-platform by default.
Assume a feature must work outside Node unless the request is explicitly Node-specific.

- Put Node-only behavior under `src/node/`.
- Avoid ambient `process`, `AsyncLocalStorage`, or signal assumptions in shared code.
- Keep public contracts platform-neutral when possible.
- If behavior depends on platform capability, fail fast with Runner-native errors instead of silently degrading unless graceful degradation is already part of the framework contract.

Read `../../../readmes/MULTI_PLATFORM.md` when touching runtime/platform behavior.

## Keep The Codebase Maintainable

Implement with the repo conventions that matter most for architecture work:

- Keep files small and story-shaped.
- Decouple early when a file starts mixing contracts and wiring.
- Use only relative imports.
- Keep imports at the top unless there is a real optimization reason not to.
- Add JSDoc to every public type surface the change introduces.
- Prefer `check()` / `Match` over ad-hoc runtime validation.
- Prefer Runner errors over raw `Error`.

## Use The Right References

Load only what the task needs:

- Use the repo context above first; this skill is intentionally grounded in the Runner repository layout and architecture.
- Read `../../../readmes/COMPACT_GUIDE.md` for the current public story and API shape.
- Read `../../../guide-units/02-resources.md` when changing boundaries, exports, subtree policy, or overrides.
- Read `../../../guide-units/DOCS_STYLE_GUIDE.md` when changing docs or compact guides.
- Read `./references/ARCHITECTURE_PLAYBOOK.md` for the architecture checklist and design heuristics used by this skill.

## Finish Completely

Before finishing:

- Ensure the architecture still reads clearly from public contract to implementation.
- Update documentation inputs when the public story changed.
- Update `readmes/COMPACT_GUIDE.md` when the change affects the architecture or public mental model.
- Run `npm run qa`.
- Prefer focused tests during iteration, then finish with the full QA run.
