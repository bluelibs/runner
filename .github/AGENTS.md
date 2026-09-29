# Repository CI And Contribution Files

> **Keep This Guide Current:** If you make changes within this directory, update this `AGENTS.md` in the same change whenever responsibilities, entry points, contracts, or test guidance change. Keep it concise and accurate; do not make artificial edits when the guidance still holds.

## Scope And Entry Points

This directory owns GitHub workflows, issue templates, contribution guidance, and dependency update policy.

- `workflows/ci.yml`: typecheck, lint, benchmark comparator tests, and coverage-enforced source tests with Redis/RabbitMQ. API docs and Pages deployment run on pushes to main.
- `workflows/real-infrastructure.yml`: focused live Redis/RabbitMQ fault tests, selected path-triggered PR checks, manual runs, and a weekly schedule.
- `workflows/bench-regression.yml`: base/head comparison with identical head workloads and protected base thresholds, plus built entry-point/consumer checks.
- `workflows/security.yml`: production dependency audit.
- `dependabot.yml`: dependency update configuration.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `ISSUE_TEMPLATE/`: contributor-facing policy and intake.

## Contracts To Preserve

- Keep workflow checks aligned with root `../package.json` and `../config/`. They exercise different concerns; one green workflow does not replace all required checks.
- Live infrastructure tests require explicit environment flags and service URLs; mock-only runs do not verify broker fault behavior.
- Benchmark comparisons retain the base revision's policy and use equivalent workloads for both runtimes.
- Preserve least-privilege workflow permissions, fork-safe secret handling, and branch/event conditions on publishing steps.
- Do not add unrelated workflow or publishing behavior while documenting modules.

## Validation

For workflow changes, inspect event/path triggers and run the corresponding local commands where services are available. For documentation-only edits, verify referenced files and stated responsibilities; full QA is unnecessary.
