# Decorator Compatibility Entrypoints

This directory presents standard and legacy decorator APIs for Match schemas and
Serializer fields. Matching and serialization implementations live in neighboring
modules; these entrypoints adapt decorator signatures and metadata access.

## Maintenance

If you make changes within this directory, update this AGENTS.md in the same change
to reflect affected responsibilities, entry points, contracts, and tests. Keep it
concise and accurate; if the guidance remains accurate, make no artificial edits.

## Entry Points And Ownership

- [es.ts](es.ts) re-exports the standard Match and Serializer surfaces and their
  decorator types for the explicit `@bluelibs/runner/decorators/es` package subpath.
- [legacy.ts](legacy.ts) substitutes legacy `Match.Schema`, `Match.Class`, and
  `Match.Field` signatures while retaining the shared matching implementation.
- The legacy Serializer subclasses the shared Serializer and supplies its own
  legacy `Field` adapter; preserve this separation from the standard static surface.
- [metadata.ts](metadata.ts) reads own `Symbol.metadata` records and checks standard
  decorator context metadata. It does not install a metadata polyfill.
- [../tools/check/decorators.ts](../tools/check/decorators.ts) implements Match adapters;
  [../tools/check/classSchema.ts](../tools/check/classSchema.ts) merges schema metadata.
- [../serializer/decorators.ts](../serializer/decorators.ts) implements Serializer adapters.
- Package subpaths and build outputs are declared in [../../package.json](../../package.json).

## Contracts To Preserve

- Standard and legacy decorators have different calling conventions. Keep exported
  types aligned with their actual adapter; a re-export alone cannot bridge them.
- Standard decorators require `Symbol.metadata` support before decorators execute;
  missing metadata fails explicitly through the caller's error factory.
- Own-metadata lookup must not accidentally read inherited records as a class's own
  fields. Class inheritance and mixed legacy/standard chains are merged downstream.
- Non-decorator Match methods and `check` behavior should remain shared across
  entrypoints. Compatibility code should not become a second matcher implementation.
- `Match.Class` remains the deprecated alias for `Match.Schema`; changing an alias
  requires coordinated runtime and type exports.
- Keep legacy `Match.infer` and Serializer constructor/instance behavior compatible
  with the common surfaces. These files are portable package entrypoints.

## Tests

- [../__tests__/decorators](../__tests__/decorators) covers entrypoint exports,
  standard decorators, legacy transpilation, metadata setup, and internal branches.
- Start with `decorator-entrypoints.test.ts`, `default-es-decorators.test.ts`,
  `legacy-decorator-transpile.test.ts`, and `decorator-internals.coverage.test.ts`.
- [../__tests__/tools/check.decorators.test.ts](../__tests__/tools/check.decorators.test.ts)
  exercises schema behavior; [../__tests__/tools/check.hydration.test.ts](../__tests__/tools/check.hydration.test.ts)
  covers parsed class instances.
- [../__tests__/serializer](../__tests__/serializer) checks field serialization behavior;
  declaration compatibility also lives under [../__tests__/type-tests](../__tests__/type-tests).
