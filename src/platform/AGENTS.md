# Platform Adapters

## Maintenance

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Responsibility

This is the environment boundary for portable Runner code: process hooks,
environment variables, timers, async-local storage, and browser file sentinels.
Keep platform capabilities here; backend transports belong under `src/node`.

## Start Here

- [types.ts](types.ts): `IPlatformAdapter` and `IAsyncLocalStorage` contracts.
- [factory.ts](factory.ts): build-time `__TARGET__` selection.
- [index.ts](index.ts): lazy cached adapter, overrides/reset, environment guards,
  and the compatibility `PlatformAdapter` wrapper.
- [adapters/universal.ts](adapters/universal.ts): detection and lazy delegation.
- [adapters/node-als.ts](adapters/node-als.ts): isolated Node ALS loading.
- [createFile.ts](createFile.ts) and [createWebFile.ts](createWebFile.ts):
  portable Blob-backed file sentinels; Node sources use `node/files` instead.

## Contracts To Preserve

- The cached adapter is module-level host state, not a runtime-owned registry.
  Tests that override it must reset it; do not put per-runtime state here.
- The universal adapter retains its `universal` id while delegating capabilities.
  Deno/Bun use the generic capability-probing path.
- `init()` can hydrate async-local storage support. Capability checks and
  unsupported-operation behavior differ by adapter; do not pretend missing ALS
  provides actual isolation.
- Subscription methods return cleanup functions. Browser/worker lifecycles differ
  from process shutdown; preserve each adapter's semantics.
- Keep Node imports behind the isolated loader so browser/edge bundles remain usable.
- File sentinels retain public metadata and the `_web` Blob sidecar for upload;
  the sidecar is client data, not serialized task input.

## Tests And Further Reading

- [Platform tests](../__tests__/platform): target selection, adapter overrides,
  environment probing, cleanup, timers, ALS hydration, and file helpers.
- [Node ALS hydration](../__tests__/platform/node.als.hydration.coverage.test.ts)
  and [edge ALS](../__tests__/platform/edge.als.test.ts) exercise loading behavior.
- [Multi-platform guide](../../readmes/MULTI_PLATFORM.md) explains package boundaries.
