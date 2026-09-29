# Builtin Middleware Policies

## Scope And Maintenance

This directory implements task/resource execution policies. Composition and
interception live in `../../models/middleware/`; public aliases live in
`../globalMiddleware.ts`. State resources isolate each runtime's policy state.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Read By Concern

- `retry.middleware.ts`, `timeout.middleware.ts`, and `fallback.middleware.ts`
  wrap execution and expose policy metadata through the execution journal.
- `concurrency.middleware.ts` plus `concurrency/` own local semaphores,
  distributed admission, wait/cancellation rules, and validation.
- `rateLimit.middleware.ts`/`rateLimit.resource.ts` own keyed rate state;
  `circuitBreaker.middleware.ts` owns circuit transitions and its resource.
- `temporal.middleware.ts`, `temporal.resource.ts`, and `temporal.shared.ts`
  implement debounce/throttle and lifecycle cleanup.
- `cache/` separates cache provider/resource, middleware, key normalization,
  shared invalidation state, and invalidation coordination.
- `requireContext.middleware.ts` and `identityChecker.middleware.ts` enforce
  context/identity. `identityRequirement.shared.ts` centralizes requirements.
- `identityScope.contract.ts`/`identityScope.shared.ts` partition policy state;
  `keyBuilder.shared.ts` and `keyedState.shared.ts` define shared key/capacity
  and cleanup contracts.

## Contracts To Preserve

- Keys receive canonical runtime task IDs. Never truncate them to local names;
  similarly named tasks in different subtrees must keep distinct buckets.
- Key defaults differ deliberately: `defaultStorageTaskKeyBuilder` partitions
  by task lineage; `defaultTaskKeyBuilder` also serializes input. Keep each
  policy's chosen default and fail when default input serialization is invalid.
- Omitted identity scope automatically partitions by tenant when present;
  explicit tenant scope requires identity unless `required: false` is supplied.
- Omitted coordination adopts a registered resilience backend; `local` forces
  memory; `distributed` requires a backend and fails at startup if absent.
  Explicit semaphore handles retain their local coordination restrictions.
- Retry, timeout, cache, and fallback share typed journal keys. Preserve nested
  collector restoration, retry-attempt attribution, and shared abort signals.
- Scoped cache keys include identity namespaces. `invalidateKeys()` uses raw
  supplied keys by default; explicit `identityScope` transforms base keys.
  Semantic reference invalidation is a separate path.
- Key capacity checks prune first and retain existing keys. Cleanup timers,
  waiting calls, pending temporal work, and semaphores need lifecycle cleanup.
- Preserve typed Runner errors and cancellation propagation across policy layers.

## Tests

- `../../__tests__/globals/middleware/` mirrors most policies and helpers.
- `../../__tests__/globals/retry.middleware.test.ts` and
  `../../__tests__/globals/timeout.middleware.test.ts` cover the shared wrappers.
- `../../__tests__/globals/middleware/default-keyed-middleware.behavior.test.ts`
  checks default partitioning and collisions.
- `../../__tests__/globals/middleware/identityScope.middleware.test.ts`
  checks identity policies; the sibling cache tests cover scoped invalidation.
- `../../__tests__/globals/resilience/coordination.test.ts` covers backend choice.

Run focused policy/integration tests and repository QA for source changes.
