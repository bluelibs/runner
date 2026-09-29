# Event Dispatch Internals

## Scope And Maintenance

`../EventManager.ts` owns admission, payload validation, execution frames, and
public emission methods. This directory owns dispatch machinery and reports;
Runner hooks are stored as listeners internally.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Entry Points

- `ListenerRegistry.ts` stores exact-event/global hooks, maintains stable sorted
  insertion, and caches merged listener lists.
- `EmissionContext.ts` connects interceptor progression, the deepest emission
  wrapper, dispatch, and execution reporting.
- `InterceptorPipeline.ts` composes emission and hook interceptors.
- `EmissionExecutor.ts` implements sequential, parallel, and transactional
  execution, filtering, cancellation, failure reports, and rollback.
- `types.ts` defines listener storage, handler options, and interceptor types.
  `EmissionContext.ts` also implements the emission propagation methods.
- `../hook/resolveHookTargets.ts` resolves hook event selectors during wiring.

## Contracts To Preserve

- Event and hook IDs here are runtime IDs. Definitions and their identity
  metadata carry more information than local names; retain them in wrappers.
- Equal-order insertion is stable. Exact-event listeners precede global
  listeners on equal order during merge.
- Registration/removal invalidates the relevant merged cache. Cached arrays
  must not be mutated by dispatch; copy before operations that mutate lists.
- Events tagged `excludeFromGlobalHooks` skip global hooks, while their exact
  hooks still run.
- An emission snapshots its interceptors so concurrent disposal cannot change
  the in-flight pipeline. Preserve the deepest wrapper for interceptor edits;
  each interceptor calls `next()` at most once and keeps propagation methods.
- Reports distinguish total, attempted, skipped, successful, failed, and stopped
  propagation; cancellation and failure modes must preserve those meanings.
- Transactional emissions are sequential, fail fast, and throw on failure.
  Successful hooks return undo closures; rollback runs in reverse completion
  order and retains both the triggering error and rollback failures.
- Hook/source tracking belongs to the runtime admission controller. Internal
  lifecycle emission bypass stays explicit in `EventManager.ts`.

## Tests

- `../../__tests__/models/event/ListenerRegistry.test.ts`
- `../../__tests__/models/event/EmissionExecutor.branches.test.ts`
- `../../__tests__/models/EventManager.test.ts`
- `../../__tests__/models/EventManager.parallel.test.ts`
- `../../__tests__/models/EventManager.transactional.test.ts`
- `../../__tests__/run/run.hook.selectors.test.ts`
- `../../__tests__/run/run.hook.transactional.test.ts`

Check ordering, filtering, propagation, cancellation, and rollback when editing
execution. Run matching tests and repository QA for source edits.
