# Builtin Runner Definitions

## Scope And Maintenance

This directory defines the shared-platform resources, events, middleware, and
tags exposed through Runner namespaces. These are definition objects; mutable
runtime state belongs in resource initialization/context, not module globals.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Namespace Entry Points

- `globalResources.ts` combines system infrastructure and app-facing utilities.
- `globalEvents.ts` defines runtime lifecycle events and their builtin list.
- `globalMiddleware.ts` exposes task/resource policy namespaces and preserves
  configured-from identity for frozen public aliases.
- `globalTags.ts` defines discovery/policy tags, including cron, health gates,
  identity scope, and remote-lane metadata.
- `debug.ts` and `types.ts` expose shared debug/namespace contracts.
- `../models/BuiltinsRegistry.ts` is the source of automatic registration;
  appearing in a namespace does not by itself make a definition automatic.

## Modules

- `resources/` defines infrastructure service dependencies and app utilities:
  store, task runner, event/middleware managers, runtime, health, timers, queue,
  logger, serializer, execution context, and identity context.
- `resources/debug/debug.resource.ts` composes debug config, event observation,
  hook/middleware interception, and execution tracking.
- `middleware/AGENTS.md` explains builtin execution policies and keyed state.
- `cron/AGENTS.md` explains tagged-task scheduling and its lifecycle.
- `resilience/AGENTS.md` explains shared coordination contracts; the Redis
  implementation lives in `../node/resilience/`.

## Contracts To Preserve

- Builtin infrastructure definitions are bound to the current runtime through
  store bootstrap. Never instantiate a separate manager inside a dependency
  resource and accidentally split interception or lifecycle state.
- Namespace aliases preserve reference provenance so framework and app-owned
  registrations can coexist. Do not reduce identity to a shared local name.
- Mutable cache, queue, scheduling, and policy state must remain isolated across
  parallel `run(app)` calls, with cleanup owned by their resource lifecycle.
- Validate configuration with Runner schemas/check tools at boundaries; retain
  target constraints and deprecation behavior for tags.
- Keep Node imports out of this shared entry point. Debug/context features must
  respect platform capabilities and runtime isolation.

## Tests

- `../__tests__/globals/globalResources.coverage.test.ts`
- `../__tests__/globals/globalTags.containerInternals.test.ts`
- `../__tests__/globals/runtime.resource.test.ts`
- `../__tests__/globals/health.resource.test.ts`
- `../__tests__/globals/debug/debug.isolation.test.ts`
- `../__tests__/index/main.exports.test.ts`
- `../__tests__/public/public-api-classification.test.ts`

Use the feature's globals tests and runtime integration tests for source changes,
then run repository QA. Documentation-only edits skip QA.
