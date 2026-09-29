# Runtime Support

> **Keep This Guide Current:** If you make changes within this directory, update this `AGENTS.md` in the same change whenever responsibilities, entry points, contracts, or test guidance change. Keep it concise and accurate; do not make artificial edits when the guidance still holds.

## Scope

This small directory supports process-level runtime bookkeeping and standard decorator metadata. Execution admission, timers, and recovery controllers are in [../models/runtime/AGENTS.md](../models/runtime/AGENTS.md).

## Entry Points

- `activeRunResults.ts` tracks live `RunResult` instances and returns a copied set for snapshots.
- `activeRunResultsForTests.ts` disposes tracked runtimes, optionally retaining the runtimes present before a test.
- `ensureSymbolMetadata.ts` installs `Symbol.metadata` only when the runtime does not provide it.
- `../run.ts` registers a successful live run and unregisters it during artifact disposal. Dry runs do not enter the active-run set.
- `../__tests__/jest.setup.ts` snapshots before each test and performs cleanup afterward.

## Contracts To Preserve

- The registry tracks runtimes; it must not become a shared store for app definitions, middleware state, or execution context.
- Return snapshot copies so callers cannot mutate the live registry.
- Test cleanup is best-effort so teardown errors do not replace the original failure. Normal runtime error handling remains separate.
- Metadata initialization must preserve an existing platform implementation.

## Validation

See `../__tests__/runtime/activeRunResultsForTests.test.ts` for cleanup behavior, and decorator/index tests for metadata initialization. Use focused tests, then `npm run qa` for code changes.
