# Runtime Store

## Scope And Maintenance

This directory compiles registration into one runtime's canonical registry,
validates wiring, and coordinates resource lifecycle. `Store.ts` is the facade;
keep registration details and lifecycle policy in their existing collaborators.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Entry Points

- `Store.ts` exposes registered maps, lookup, bootstrap, lifecycle, and locks.
- `StoreRegistry.ts` owns registry maps, definition identity/source lookup,
  ownership tracking, tags, and graph construction.
- `StoreLookup.ts` distinguishes extracting a requested ID from finding a
  registered canonical ID. A candidate alone does not prove registration.
- `StoreBootstrapCoordinator.ts` registers framework/app definitions, applies
  overrides, validates, and starts dependency processing.
- `StoreLifecycleCoordinator.ts` owns ready/cooldown/dispose waves and resource
  lifecycle execution. Ordering helpers also live in `../utils/`.
- `StoreValidator.ts` delegates constraints to `../validators/`.

## Registration Compiler

- `store-registry/StoreRegistryWriter.ts` routes registerable kinds to owned
  registration, preparation, normalization, and registry writes.
- `store-registry/CanonicalIdCompiler.ts` builds IDs from owner scope and kind;
  `OwnerScope.ts` distinguishes synthetic framework-root registration.
- `StoreRegistryDefinitionCloner.ts` in that directory clones definitions
  before assigning runtime IDs, including nested helper definitions.
- `StoreRegistryReferenceNormalizer.ts` and the tag reference normalizer connect
  authored references to registered definitions.
- `StoreRegistryTagIndex.ts` and `StoreRegistryTagMatchCollector.ts` maintain
  identity-aware tag discovery; do not replace them with local-ID matching.

## Contracts To Preserve

- Canonical IDs encode owner and kind, such as `app.tasks.work`. Source IDs,
  local IDs, object identity, and canonical/storage IDs serve different roles.
- Preserve original authoring objects and helper behavior when preparing
  runtime-owned definitions. Multiple runtimes may share those objects.
- Registration maintains maps, ownership, reference lookup, and tag indexes
  together. Owned registration fails fast and discards a failed build; do not
  introduce a partial visibility-only rollback for that path.
- Explicit exports and isolation apply to dependency wiring as well as runtime
  access. Route checks through `../VisibilityTracker.ts`.
- Locks freeze mutable registration/interception surfaces after startup.
  Do not sidestep locks or defer invalid wiring until task execution.
- Track initialized and ready resources distinctly so failure cleanup and
  parallel lifecycle waves operate on the right resources.

## Tests

Paths below are relative to this directory:

- `../../__tests__/models/StoreRegistry.facade.test.ts` and
  `StoreRegistryDefinitionPreparer.test.ts` beside it cover registry seams.
- `../../__tests__/models/store/store-registry/CanonicalIdCompiler.test.ts`
  covers IDs; sibling tag-index and writer tests cover registration details.
- `../../__tests__/models/StoreLookup.coverage.test.ts` covers lookup fallbacks.
- `../../__tests__/run/run.source-admission.test.ts` and
  `run.root-isolation.regression.test.ts` beside it cover runtime boundaries.
- `../../__tests__/run/run.parallel-ready.test.ts`,
  `run.parallel-dispose.test.ts`, and `run.lazy-init-mode.test.ts` beside it
  cover lifecycle ordering. Run focused tests and QA for source changes.
