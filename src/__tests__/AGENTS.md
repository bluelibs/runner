# Portable And Core Tests

> **Keep This Guide Current:** If you make changes within this directory, update this `AGENTS.md` in the same change whenever responsibilities, entry points, contracts, or test guidance change. Keep it concise and accurate; do not make artificial edits when the guidance still holds.

## Scope And Navigation

These tests exercise the portable framework and cross-module runtime contracts. Node-only feature suites are in [../node/__tests__/AGENTS.md](../node/__tests__/AGENTS.md).

- `definers/`, `defs/`, `types/`, and `type-tests/`: builder behavior, definitions, inference, and compile-time restrictions.
- `models/`, `run/`, and `system/`: services, boot/shutdown, visibility, overrides, isolation, and end-to-end wiring.
- `globals/`, `tools/`, `validation/`, `serializer/`, and `errors/`: built-ins and supporting boundaries.
- `platform/`, `index/`, `public/`, `decorators/`, and `package.exports.runtime-conditions.test.ts`: platform capabilities and exported surfaces.
- `http/`, `rpc-lane/`, `remote-lanes/`, `security/`, and `recursion/`: transport, access, and recursion contracts.
- `test-utils.ts` and `test-utils/`: shared test support; `jest.setup.ts` initializes the platform and cleans up active runtimes and process hooks.
- `benchmark/`: performance workloads under the separate benchmark configuration, not normal behavior tests.

## Test Contracts

- Use a minimal registered app and real `run(app)` when testing wiring. Dispose the runtime and close timers, sockets, and listeners you own.
- Preserve isolation across simultaneous runs; use separate apps to catch shared mutable state.
- Test failures, cancellation, identity, and lifecycle boundaries when a change affects them. Do not add tests that only repeat reversible documentation or cosmetic edits.
- Compile-time expectations belong in type suites and must be checked by typecheck; Jest transformation disables TypeScript diagnostics.
- Do not exclude files or weaken thresholds to obtain 100% coverage. Distinguish pre-existing unrelated gaps from new gaps.

## Commands From The Repository Root

- `npm run test -- <searchKey>` selects focused behavior tests; `npm run test:serial -- --runTestsByPath <path>` is useful for a specific suite.
- `npm run typecheck` validates TypeScript contracts.
- `npm run qa` runs the repository's full code-change checks, including coverage, linting, build, and consumer compatibility. Skip it for docs-only changes.
- `npm run benchmark` runs the separate performance suites. Benchmark comparison tests live in `../../scripts/__tests__/`.

Configuration lives in `../../config/jest/` and `../../config/ts/`. Keep helper cleanup aligned with `../runtime/activeRunResultsForTests.ts` and `../tools/processShutdownHooks.ts`.
