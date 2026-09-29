# Middleware Composition

## Scope And Maintenance

This directory builds task and resource execution pipelines. Builtin policies
live in `../../globals/middleware/`; this layer owns how policy, validation,
interceptors, and execution metadata fit together.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Entry Points

- `../MiddlewareManager.ts` is the public coordination facade.
- `MiddlewareResolver.ts` selects global/subtree/local middleware, resolves
  definition IDs, enforces subtree conflicts and identity scope, and filters
  task middleware for RPC lane policy.
- `TaskMiddlewareComposer.ts` builds a task runner; `ResourceMiddlewareComposer.ts`
  wraps resource initialization with the effective registered definition.
- `InterceptorRegistry.ts` stores global and middleware-specific interceptors.
- `ValidationHelper.ts` centralizes input/config/result validation.
- `composeLayers.ts` performs reverse wrapping so declaration order becomes
  outer-to-inner execution order.
- `applicationIdentity.ts` distinguishes repeated distributed policy
  applications without adding wrappers to ordinary middleware.

## Contracts To Preserve

- Task layers are built outward from validation/task execution: local task
  interceptors, middleware, then global task interceptors. Global interceptors
  must still see middleware short circuits, such as cache hits.
- `next()` forwards the current input; `next(undefined)` explicitly replaces it.
  Use argument presence, not a nullish fallback, to preserve that difference.
- Use canonical task/middleware IDs for lookup and runtime execution metadata.
  Runtime-routed task definitions may differ from authored definitions.
- Local and subtree duplicates follow resolver conflict/override rules;
  preserve existing duplicate keys and filters rather than concatenating lists.
- Share journals with nested execution when forwarded. Always release caller
  signals and active abort-controller tracking after a call finishes.
- Wrap middleware execution with its runtime source and lifecycle tracking.
- Distributed application identities include canonical task ID, middleware ID,
  and occurrence counted from the inside out. Do not collapse repeated layers.

## Tests

Paths below are relative to this directory:

- `../../__tests__/models/MiddlewareManager.test.ts` covers the facade.
- `../../__tests__/models/middleware/ResourceMiddlewareComposer.order.repro.test.ts`
  covers resource wrapping order.
- `../../__tests__/models/middleware/interceptor.default-next.test.ts` and
  `applicationIdentity.test.ts` beside it cover forwarding and layer identity.
- `../../__tests__/run/run.middleware.next-undefined.test.ts` covers replacement.
- `../../__tests__/run/run.subtree.middleware-predicate.test.ts` and
  `run.subtree.identity-scope.test.ts` beside it cover resolver policy.
- `../../__tests__/run/task-interceptor.definition-identity.test.ts` checks
  definition identity. Run matching tests and repository QA for source edits.
