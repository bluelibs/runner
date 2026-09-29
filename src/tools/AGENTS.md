# Runtime Tools

> **Keep This Guide Current:** If you make changes within this directory, update this `AGENTS.md` in the same change whenever responsibilities, entry points, contracts, or test guidance change. Keep it concise and accurate; do not make artificial edits when the guidance still holds.

## Responsibilities And Entry Points

This directory holds focused helpers shared by definitions and runtime orchestration. It is portable; environment capabilities go through `../platform/`.

- `createRuntimeServices.ts` constructs the isolated service graph consumed by `../run.ts`.
- `normalizeRunOptions.ts` resolves user options before boot; support assertions reject unavailable execution-context or identity capabilities.
- `BootstrapCoordinator.ts` and `runShutdownController.ts` coordinate startup cancellation, completion, and per-run shutdown.
- `shutdownDisposalLifecycle.ts`, `disposalBudget.ts`, `ForceDisposalController.ts`, and `runDisposalSignal.ts` manage draining, budgets, forced teardown, and outer signals.
- `processShutdownHooks.ts` multiplexes platform shutdown/error hooks; it is shared process coordination, not app state.
- `definitionId.ts` distinguishes source, local, canonical, and storage IDs. `isSameDefinition.ts` handles stable lineage identity and configured wrappers.
- `scope.ts`, `subtreeOf.ts`, and `classifyIsolationEntry.ts` define selector semantics; `buildUniversalManifest.ts` builds portable upload manifests and collects file sources.
- [check/AGENTS.md](check/AGENTS.md) explains validation, matching, schemas, and hydration behind `check.ts`.

## Contracts To Preserve

- Construct services for each run. Shared process listeners must detach correctly without tearing down another runtime's hooks.
- The outer run signal controls bootstrap/disposal; execution signals have their own propagation contract. Preserve listener cleanup and abort reasons.
- Cleanup must also work before bootstrap completes and after partial initialization. Keep lifecycle ordering and disposal budgets explicit.
- Compare definitions through lineage identity. Preserve full canonical/storage IDs for internal state; plain identity-less references have a separate fallback contract.
- Normalization is a boundary operation. Once inputs are validated, keep internal types strict rather than repeatedly probing shapes.

## Validation

Use `../__tests__/tools/`, `../__tests__/run/`, and `../__tests__/system/` for helper, lifecycle, and isolation behavior. In particular, `definitionId.test.ts`, `isSameDefinition.test.ts`, `runDisposalSignal.test.ts`, and shutdown tests exercise the fragile seams. Run focused tests from the repository root, then `npm run qa` for code changes.
