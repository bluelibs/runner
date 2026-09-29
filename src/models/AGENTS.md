# Runtime Models

## Scope And Maintenance

These are the platform-neutral services that turn definitions into an executable
runtime. State belongs to each `run(app)`; Node-only implementations belong in
`../node/`. Follow the repository instructions as well as narrower guides.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Read First

- `../run.ts` constructs services and coordinates startup and shutdown.
- `store/Store.ts` is the registry and lifecycle facade; see `store/AGENTS.md`.
- `DependencyProcessor.ts` computes dependencies and initializes resources.
  Its `dependency-processor/` helpers separate extraction, hook buffering, and
  dependency-aware resource scheduling.
- `TaskRunner.ts` owns admission, health checks, execution context, and composed
  task runner caching. `task-runner/TaskHealthPolicyChecker.ts` implements the
  `failWhenUnhealthy` gate.
- `EventManager.ts` coordinates emissions; `event/AGENTS.md` explains dispatch.
- `MiddlewareManager.ts` delegates composition; see `middleware/AGENTS.md`.
- `RunResult.ts` implements the runtime users receive: task/event access,
  resource lookup, inspection, health, pause/recovery, and disposal.
- `runtime/AGENTS.md` covers admission, cancellation, recovery, and timers.
- `VisibilityTracker.ts` delegates ownership/access checks to
  `visibility-tracker/`; see its `AGENTS.md` before changing isolation.

## Supporting Services

- `BuiltinsRegistry.ts`, `createSyntheticFrameworkRoot.ts`, and
  `frameworkNamespaceMetaPolicy.ts` define builtin registration and ownership.
- `OverrideManager.ts` resolves override winners before dependency wiring.
- `ResourceInitializer.ts` creates resource context and runs middleware-wrapped
  initialization. `utils/` supplies dependency graphs and disposal ordering.
- `validators/` owns boot-time constraints through the store validator.
- `ExecutionContextStore.ts` tracks execution frames and signals via the
  platform abstraction. `RuntimeCallSourceStore.ts` tracks who initiated work.
- `ExecutionJournal.ts` stores typed, identity-keyed metadata for one execution
  tree; forwarded journals deliberately share state with nested task calls.
- `runtime-inspector/` builds runtime inspection views; `HealthReporter.ts`
  coordinates resource health. `Logger.ts`, `LogPrinter.ts`, and
  `UnhandledError.ts` own logging and unhandled-error reporting.
- `Queue.ts` and `Semaphore.ts` are reusable concurrency primitives.

## Contracts To Preserve

- Keep canonical runtime IDs in stateful maps. Resolve definition references
  through the store; local names are not unique across resource subtrees.
- Tasks recompose before the store locks so initialization-time interceptors
  take effect. Cache composed runners only after locking.
- Prepare hook dependencies before resource initialization can emit events;
  retain buffered-event and concurrent initialization behavior.
- Lifecycle work and ordinary work have different admission rules. Propagate
  call source, journal, and abort signal through wrappers rather than inventing
  fresh metadata at each boundary.

## Tests

Model tests live in `../__tests__/models/`; public runtime behavior lives in
`../__tests__/run/`. Start with `TaskRunner.test.ts`, `Store.test.ts`,
`DependencyProcessor.consistency.test.ts`, and `RunResult.test.ts` in the model
suite, then the matching regression or lifecycle test. For source changes run
focused tests and repository `npm run qa`; documentation-only changes skip QA.
