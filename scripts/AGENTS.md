# Repository Scripts

> **Keep This Guide Current:** If you make changes within this directory, update this `AGENTS.md` in the same change whenever responsibilities, entry points, contracts, or test guidance change. Keep it concise and accurate; do not make artificial edits when the guidance still holds.

## Start Here

Scripts are Node/shell tooling for this repository, not part of the portable runtime. Root `../package.json` defines the supported commands.

- `run-jest-watchdog.mjs`: test process supervision used by normal/CI test commands.
- `run-coverage-ai.mjs`, `jest-ai-reporter.js`, `print-fresh-coverage.mjs`, and `coverage-scope.mjs`: compact coverage reporting and fresh result accounting.
- `compose-guide.mjs`: reads explicit include manifests in `../guide-units/`, writing the generated landing README and full guide. It does not discover every Markdown file in that folder.
- `check-built-entrypoints.mjs`: imports built entry points independently; `check-consumer-bundles.mjs` bundles browser and Node consumers against package exports.
- `compare-benchmarks.mjs` and `__tests__/compare-benchmarks.test.mjs`: benchmark contracts; configuration/data live in `../config/benchmarks/`.
- `pack-npm-skills.mjs`: temporarily materializes linked guide/readme references for npm packaging and restores symlinks afterward.
- `verify-durable-pagination.mjs`: targeted durable pagination verification.
- Size-check scripts and `update-baseline.sh`: maintenance helpers. PR lookup/comment scripts support repository administration, not framework behavior.

## Contracts To Preserve

- Resolve repository-owned paths explicitly; do not assume a consumer's working directory matches the repository unless the command requires it.
- Forward process exit status and preserve intentional watchdog/cleanup behavior.
- Coverage display must match Jest's instrumented source scope. Never mask gaps by filtering files away.
- Generated documentation is output, not an authoring surface. Update the include sources and compose them when their content changes.
- Packaging swaps symlinks for copies temporarily. Do not leave materialized reference trees committed or overwrite canonical documentation from the copies.
- Benchmark comparisons must retain base thresholds and equivalent workloads across revisions.

## Validation

Run `npm run test:benchmark-compare` for benchmark comparator changes; use the owning package commands for other scripts. Run `npm run qa` for code/tooling changes. Docs-only changes to this guide need verified references only.
