# Fluent Builders

Builders refine typed declarations before `.build()` delegates to the corresponding
`define*` function. This is authoring-time composition, not runtime graph wiring.

## Maintenance

If you make changes within this directory, update this AGENTS.md in the same change
to reflect affected responsibilities, entry points, contracts, and tests. Keep it
concise and accurate; if the guidance remains accurate, make no artificial edits.
The parent [../AGENTS.md](../AGENTS.md) covers low-level definers.

## Layout And Entry Points

- Most primitive builders have an `index.ts` constructor, `types.ts` state,
  `fluent-builder.interface.ts` public phases, `fluent-builder.ts` implementation,
  and `utils.ts` helpers. Begin with the relevant primitive rather than every builder.
- Middleware splits its phases and implementations into `task.interface.ts`/`task.ts`
  and `resource.interface.ts`/`resource.ts`; [override/index.ts](override/index.ts)
  holds the override builder without the usual per-primitive file split.
- [task](task), [resource](resource), [event](event), and [hook](hook) are the main
  authoring paths; [task.ts](task.ts) and [eventLane.ts](eventLane.ts) are re-export shims.
- [tag](tag), [error](error), [asyncContext](asyncContext), and
  [middleware](middleware) hold their corresponding fluent surfaces.
- [rpcLane](rpcLane) and [eventLane](eventLane) define lane authoring and topology;
  RPC HTTP client authoring helpers also live in `rpcLane`.
- [core.ts](core.ts) contains shared builder snapshot interfaces.
- [shared/mergeUtils.ts](shared/mergeUtils.ts) merges dependencies and arrays;
  [shared/snapshotMetadata.ts](shared/snapshotMetadata.ts) isolates metadata snapshots.
- Follow exports through [../../index.ts](../../index.ts) to see how callers reach `r`.

## Contracts To Preserve

- Each chain method returns a new state/builder. A later branch must not change
  an earlier branch's dependencies, metadata, arrays, or eventual built definition.
- Dependency merge behavior distinguishes config-aware resource dependencies from
  task-style dependencies. Respect explicit replacement options and lazy suppliers.
- Builder type phases encode ordering: for example task `.run()` closes shape-changing
  methods, while metadata, throws declarations, and `.build()` remain available.
- Missing required handlers/selectors fail at build time even when JavaScript callers
  bypass the TypeScript phase constraints. Do not rely only on missing methods in types.
- Schema aliases must delegate to the same normalization and inference path as their
  explicit input/config/payload counterparts. Results retain promise-aware inference.
- `.build()` must preserve direct-definition validation, branding, freezing, and
  caller file metadata. New fluent features need matching low-level support.
- Preserve tuple inference for tags/middleware and contract intersections; broad arrays
  or casts can silently weaken public input, output, and config constraints.
- Keep original resource/definition references in subtree, isolate, and override
  declarations. Local id labels are insufficient for runtime canonical resolution.

## Tests

- [../../__tests__/definers](../../__tests__/definers) exercises fluent behavior:
  `task-event-hook-middleware.builder.test.ts`, `resource.builder.test.ts`,
  `dependency-map-snapshot.test.ts`, `metadata-snapshot.test.ts`, and `build-lockdown.test.ts`.
- [../../__tests__/type-tests/builders](../../__tests__/type-tests/builders) checks
  `fluent-ordering.type-test.ts`, `dependencies.type-test.ts`,
  `schemas-middleware.type-test.ts`, and `tags-contracts.type-test.ts`.
- Policy, lane, async-context, tag, and error builders have dedicated tests in those
  same directories. Include valid inference and rejected usage when changing contracts.
