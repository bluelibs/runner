# Topic Documentation

> **Keep This Guide Current:** If you make changes within this directory, update this `AGENTS.md` in the same change whenever responsibilities, entry points, contracts, or test guidance change. Keep it concise and accurate; do not make artificial edits when the guidance still holds.

## Scope And Reading Routes

This directory owns focused authored guides beyond the core learning chapters. Read only the topics needed for your change, starting with [COMPACT_GUIDE.md](COMPACT_GUIDE.md) for the core mental model.

- `ARCHITECTING_WITH_RUNNER.md`, `FLUENT_BUILDERS.md`, `FUNCTIONAL.md`, and `OOP.md`: composition and authoring styles.
- `MULTI_PLATFORM.md` and `PUBLIC_API.md`: platform boundaries and public surfaces.
- `SERIALIZER_PROTOCOL.md`: encoding/hydration contracts; compare changes with `../src/serializer/` and its tests.
- `DURABLE_WORKFLOWS.md` and `DURABLE_WORKFLOWS_AI.md`: Node workflow semantics and the compact field guide.
- `REMOTE_LANES.md`, `REMOTE_LANES_AI.md`, and `REMOTE_LANES_HTTP_POLICY.md`: transport topology and HTTP policy.
- `RUNTIME_SHELL.md`: Node shell lifecycle and operator behavior.
- `BENCHMARKS.md`, `COMPARISON.md`, `ENTERPRISE.md`, and `CRITICAL_THINKING.md`: performance and positioning; keep claims supported.

## Contracts To Preserve

- `FULL_GUIDE.md` is generated from `../guide-units/`; do not read/edit it as canonical input.
- Follow [../guide-units/DOCS_STYLE_GUIDE.md](../guide-units/DOCS_STYLE_GUIDE.md). Prefer verified defaults, valid local IDs, and complete examples.
- Keep the compact guide short. Update it for changes to the core public contract; do not fold advanced durable/remote internals into it.
- Keep main and AI field guides aligned when a topic contract changes. Contributor `AGENTS.md` files describe implementation, not a duplicate end-user API manual.
- The published skill references this directory through a symlink; change canonical files here, not packaging copies.

## Validation

Check links and claims against source/tests, and run composition only when its include inputs changed. Pure topic or contributor documentation does not need full QA. API/example code changes still follow the affected module's validation requirements.
