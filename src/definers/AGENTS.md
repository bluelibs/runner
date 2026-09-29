# Definition Construction

This directory turns author-supplied declarations into branded Runner definitions.
It owns definition-time validation and helpers; runtime registration and execution
belong to the store, managers, and `run()` wiring.

## Maintenance

If you make changes within this directory, update this AGENTS.md in the same change
to reflect affected responsibilities, entry points, contracts, and tests. Keep it
concise and accurate; if the guidance remains accurate, make no artificial edits.
For fluent APIs, also follow [builders/AGENTS.md](builders/AGENTS.md).

## Start Here

- [defineTask.ts](defineTask.ts), [defineResource.ts](defineResource.ts),
  [defineEvent.ts](defineEvent.ts), and [defineHook.ts](defineHook.ts) construct
  the central graph primitives.
- [defineTag.ts](defineTag.ts) and [defineMiddleware.core.ts](defineMiddleware.core.ts)
  own configured metadata and middleware definition helpers.
- [defineError.ts](defineError.ts) constructs typed error helpers and `RunnerError`;
  foundation registries break initialization cycles with framework errors.
- [defineAsyncContext.ts](defineAsyncContext.ts) uses the platform storage abstraction;
  [defineEventLane.ts](defineEventLane.ts) and [defineRpcLane.ts](defineRpcLane.ts)
  declare lanes whose execution implementations live under `src/node`.
- [defineOverride.ts](defineOverride.ts) and
  [resourceOverridePatch.ts](resourceOverridePatch.ts) preserve override targets.
- [tools.ts](tools.ts) supplies brand-aware definition guards.
- Public entry points are [../define.ts](../define.ts) and
  [../index.ts](../index.ts); fluent constructors live in [builders](builders).

## Contracts To Preserve

- Definition ids are local ids: non-empty strings, no dots, and no reserved local
  names. [definitionValidation.ts](definitionValidation.ts) is the shared rule.
  Canonical ids are resolved later; do not manufacture them here.
- Definitions are deep-frozen. Configured and optional wrappers retain the source
  lineage's freeze behavior; do not mutate a reusable definition during a run.
- Preserve identity symbols and original definition references when producing
  wrappers or overrides. An id string alone does not establish lineage identity.
- [normalizeValidationSchema.ts](normalizeValidationSchema.ts) accepts parse-based
  schemas, Match patterns, and decorated class shorthand. Class shorthand requires
  schema metadata; parsers can transform values, so retain their returned values.
- Tag target restrictions are checked at definition time. Runtime and type-level
  constraints must agree when changing allowed targets or attachments.
- Resource forks require leaf definitions; explicit child registration blocks
  forking. Overrides retain the base id and hook subscription selector.
- Isolate and subtree helpers keep unresolved declarations separately from display
  policies. Config-dependent declarations must survive merging until runtime wiring.

## Tests And Neighbors

- Runtime construction tests: [../__tests__/definers](../__tests__/definers), especially
  `definition-id.validation.test.ts`, `build-lockdown.test.ts`,
  `schema.normalization.unit.test.ts`, `resource.fork.basic.test.ts`, and `override.test.ts`.
- Type contracts: [../__tests__/type-tests/define](../__tests__/type-tests/define)
  and [../__tests__/type-tests/builders](../__tests__/type-tests/builders).
- Policy integration lives in [../__tests__/run](../__tests__/run); checking a display
  policy alone does not establish correct runtime visibility or middleware wiring.
- Shared public shapes and brands live in [../types](../types); validation machinery
  lives in [../tools/check](../tools/check). Keep this layer portable across platforms.
