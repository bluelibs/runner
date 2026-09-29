# Shared Runner Contracts

This directory defines the public graph and runtime shapes, inference utilities,
internal store contracts, and runtime brands. It contains executable constants and
helpers as well as TypeScript types; it is not a declarations-only directory.

## Maintenance

If you make changes within this directory, update this AGENTS.md in the same change
to reflect affected responsibilities, entry points, contracts, and tests. Keep it
concise and accurate; if the guidance remains accurate, make no artificial edits.

## Find The Contract

- [task.ts](task.ts), [resource.ts](resource.ts), [event.ts](event.ts), and
  [hook.ts](hook.ts) define graph primitives and their lifecycle/execution callbacks.
- [taskMiddleware.ts](taskMiddleware.ts), [resourceMiddleware.ts](resourceMiddleware.ts),
  [tag.ts](tag.ts), [tagged.ts](tagged.ts), and [contracts.ts](contracts.ts) describe
  attachment contracts, tag discovery, and input/output/config enforcement.
- [utilities.ts](utilities.ts) maps dependency definitions to injected values,
  handles optional dependencies, and infers validation schema inputs.
- [runner.ts](runner.ts) owns `IRuntime` and run options;
  [runtimeInspection.ts](runtimeInspection.ts) describes inspection views.
- [executionContext.ts](executionContext.ts), [executionJournal.ts](executionJournal.ts),
  [runtimeSource.ts](runtimeSource.ts), and [taskRunner.ts](taskRunner.ts) describe
  execution plumbing. `runtimeSource` also creates frozen caller-origin records.
- [subtree.ts](subtree.ts) describes composition policies;
  [storeTypes.ts](storeTypes.ts) describes registered runtime entries.
- [asyncContext.ts](asyncContext.ts), [error.ts](error.ts), [eventLane.ts](eventLane.ts),
  [rpcLane.ts](rpcLane.ts), and [remoteLaneAuth.ts](remoteLaneAuth.ts) cover specialized surfaces.
- [symbols.ts](symbols.ts) supplies runtime brands; [../defs.ts](../defs.ts) and
  [../index.ts](../index.ts) connect these files to package exports.

## Contracts To Preserve

- Type-level dependency values must match the actual injected callable/accessor/value
  shape. Optional wrappers and before-init tag dependencies need their distinct semantics.
- Keep schema inference compatible with parse-based schemas, decorated constructors,
  and Match patterns. Preserve transformed output types and awaited result handling.
- `contracts.ts` uses the `CONTRACT` brand, tuple-preserving extraction, intersections,
  and violation types. Test impossible intersections and promise-aware results.
- Symbols distinguish configured wrappers, original definitions, overrides, and
  lineage identity. Do not replace these with id-string comparison or object equality.
- Definition ids begin as local ids; registered runtime/source contracts may require
  canonical ids. Read each field's JSDoc before passing an id across layers.
- Public types and indirect public members need JSDoc. Widening generics can break
  inference without breaking compilation of the library implementation itself.
- Keep shared contracts platform-portable. Node-only implementations and exports
  belong under [../node](../node), even when shared files describe their interfaces.

## Tests And Change Surface

- Compile-time acceptance lives in [../__tests__/type-tests](../__tests__/type-tests),
  particularly `define`, `builders`, and `tools/check.type-test.ts`.
- Runtime helper tests live in [../__tests__/types](../__tests__/types), including
  `runtimeSource.test.ts` and async-context registration/dependency tests.
- Check [../__tests__/platform/types.utilities.coverage.test.ts](../__tests__/platform/types.utilities.coverage.test.ts)
  for executable utilities and [../__tests__/run](../__tests__/run) for integration.
- Contract changes usually require matching edits in [../definers](../definers),
  runtime consumers under [../models](../models), and package exports.
