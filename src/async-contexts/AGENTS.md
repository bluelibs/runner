# Built-In Async Contexts

## Maintenance

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Responsibility

The framework-provided identity and execution accessors. Business/request
identity and execution tracing are separate contracts with separate backing stores.
Generic context definitions live in `src/definers/defineAsyncContext.ts`.

## Start Here

- [index.ts](index.ts): frozen public `asyncContexts` object.
- [identity.asyncContext.ts](identity.asyncContext.ts): built-in identity schema,
  validation, access, optional dependency wrapper, and platform behavior.
- [identity.constants.ts](identity.constants.ts): reserved namespace/separator.
- [execution.asyncContext.ts](execution.asyncContext.ts): accessors, `provide()`,
  and `record()` delegated to the execution context store.
- [ExecutionContextStore](../models/ExecutionContextStore.ts): tracing mechanics.
- [Generic context definer](../definers/defineAsyncContext.ts): ALS/context registry.

## Contracts To Preserve

- `use()` requires an available context; `tryUse()` may return undefined.
  Execution context availability comes from runtime wiring or explicit provision.
- Built-in identity accepts optional non-empty tenant/user ids and role strings.
  Additional identity properties are permitted by its including-object schema.
- Reject reserved tenant `__global__` and `:` in tenant/user ids because identity
  middleware uses those values to partition state.
- Without ALS, built-in identity `provide()` runs its callback directly,
  `tryUse()` returns undefined, and `has()` is false. Identity-sensitive runtime
  features enforce platform support during boot; this accessor does not emulate it.
- The public identity context is the default. The runtime `identity` option can
  select an app context; middleware must respect that runtime-owned selection.
- Execution `provide(options, fn)` and `record(options, fn)` require a callback.
  Keep their overloads and sync/async result behavior aligned with the store.

## Tests To Read

- [Identity resource](../__tests__/globals/resources/identityContext.resource.test.ts).
- [Identity runtime option](../__tests__/run/run.identity-option.test.ts).
- [ALS support requirements](../__tests__/run/run.identity-async-context-support.test.ts).
- [Execution context integration](../__tests__/system/system.executionContext.test.ts).
- [Identity middleware](../__tests__/globals/middleware/identityScope.middleware.test.ts)
  verifies the downstream partitioning contract.
