# Build And Validation Configuration

> **Keep This Guide Current:** If you make changes within this directory, update this `AGENTS.md` in the same change whenever responsibilities, entry points, contracts, or test guidance change. Keep it concise and accurate; do not make artificial edits when the guidance still holds.

## Responsibilities

Configuration describes how the same source becomes portable, browser, edge, and Node distributions and how contracts are tested. Root `../package.json` owns the executable scripts and published export conditions.

## Start Here

- `tsup/tsup.config.ts`: universal, Node, browser, and edge bundles, decorator entry points, and compile-time `__TARGET__` selection.
- `ts/tsconfig.json`: strict repository typecheck, including source tests; `tsconfig.build.json` and `tsconfig.types.json` describe build/type output; `tsconfig.jest.json` supports test transforms.
- `jest/jest.config.js`: normal source tests, setup/cleanup, coverage scope, and 100% thresholds. `jest.bench.config.js` selects the independent benchmark suite.
- `eslint/eslint.config.mjs`: source lint/formatting rules.
- `public-api/runtime-exports.json`: runtime export expectations exercised by source tests.
- `benchmarks/`: comparison policy, baseline, and recorded results. Fresh CI comparisons use base-revision thresholds.
- `typedoc/typedoc.json` and `typedoc.custom.css`: API-site output; authored framework guides live elsewhere.

## Contracts To Preserve

- Keep emitted entry points, root exports/typesVersions, declarations, and import/require conditions aligned.
- Browser/edge/portable bundles must not acquire Node-only dependencies through a re-export. Validate actual consumers when changing builds.
- Coverage reporting scope in `../scripts/coverage-scope.mjs` must mirror instrumentation, not reduce it to hide missed code.
- Jest disables TypeScript diagnostics during transformation; typecheck remains a separate required check.
- Benchmarks use a separate configuration so performance workloads do not contaminate normal behavior/coverage runs.

## Validation

For configuration changes, run `npm run qa` from the repository root. Build/package changes also warrant reading `../scripts/check-built-entrypoints.mjs`, `../scripts/check-consumer-bundles.mjs`, and the export tests. Pure guide edits need path/reference checks, not QA.
