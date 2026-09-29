# Source Architecture

> **Keep This Guide Current:** If you make changes within this directory, update this `AGENTS.md` in the same change whenever responsibilities, entry points, contracts, or test guidance change. Keep it concise and accurate; do not make artificial edits when the guidance still holds.

## Start Here

Runner describes a typed graph first and executes it only after `run(app)`. Builders define contracts; the store compiles ownership and registration; runtime services enforce visibility, validation, lifecycle, and execution. Each run creates its own services.

- `index.ts` exports the portable surface through `public.ts`, `defs.ts`, and `public-types.ts`.
- `public.ts` assembles `r`, built-in namespaces, and runtime exports; `define.ts` exposes definition factories.
- `run.ts` wires services, registers the graph, processes overrides, validates it, initializes resources, locks registries, runs readiness, and returns `RunResult`.
- [Node entry points](node/AGENTS.md) extend the portable surface. Package export conditions select the Node entry for Node consumers; browser, edge, and universal builds must remain portable.

## Module Map

- [Definitions](definers/AGENTS.md): raw factories, fluent builders, snapshots, schemas, and local-ID validation.
- [Types](types/AGENTS.md): public contracts, generics, dependency inference, and identity symbols.
- [Runtime models](models/AGENTS.md): store, dependency processor, task/event execution, middleware, visibility, logging, and inspection.
- [Built-ins](globals/AGENTS.md): resources, events, tags, task/resource middleware, cron, and resilience contracts.
- [Tools](tools/AGENTS.md): bootstrap/shutdown coordination, IDs, scopes, and [runtime validation](tools/check/AGENTS.md).
- [Errors](errors/AGENTS.md): typed framework failures and stable error identifiers.
- [Platform](platform/AGENTS.md): environment capabilities and adapters.
- [Serialization](serializer/AGENTS.md): tree/graph encoding, type registry, validation, and hydration.
- [Portable remote lanes](remote-lanes/AGENTS.md): fetch transport and retry policy; Node lanes and exposure live under `node/`.
- [Business context](async-contexts/AGENTS.md): built-in identity context; separate from execution tracing.
- [Decorators](decorators/AGENTS.md): standard/legacy validation and serialization metadata entry points.
- [Runtime support](runtime/AGENTS.md): active-run bookkeeping for cleanup and decorator metadata initialization; admission controllers live in `models/runtime/`.
- [Tests](__tests__/AGENTS.md): mirrored behavior suites, type contracts, platform/security checks, and benchmarks.

## Contracts To Preserve

- `run(app)` instances must remain isolated, including middleware state, listeners, tracing, and teardown. Process-wide hooks coordinate cleanup rather than owning app services.
- User definitions have local IDs. Ownership compilation creates canonical IDs; stateful indexes use storage identities. Never shorten an internal ID to a leaf/display name.
- Built definitions carry stable lineage identity. Two equal strings do not establish equality between independently built definitions.
- Keep Node dependencies behind platform adapters or within `node/`; check both exports and consumer bundles when changing that boundary.
- Preserve startup validation, registry locking, lazy initialization, source-aware admission, and cleanup on bootstrap failure. Read the controllers before changing shutdown phase behavior.
- Public surfaces, including indirectly exported types, require JSDoc. Update source docs and `readmes/COMPACT_GUIDE.md` minimally when the public core story changes; advanced Node topics have dedicated guides.

## Validation

From the repository root, use `npm run test -- <searchKey>` while iterating on a behavior, then `npm run qa` for code changes. Pure documentation changes do not need QA. Tests live in `__tests__/` and `node/__tests__/`; dispose runtimes and preserve the 100% coverage contract without exclusions.
