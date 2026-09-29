# Runtime Admission And Execution Support

## Scope And Maintenance

These helpers support `../RunResult.ts`, `../TaskRunner.ts`,
`../EventManager.ts`, and store lifecycle coordination. They are shared-platform
code; keep platform services behind `../../platform/`.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Entry Points

- `LifecycleAdmissionController.ts` owns phases, in-flight task/event counts,
  active internal sources, shutdown resource allowlists, and drain waiters.
- `RuntimeRecoveryController.ts` owns pause episodes and recovery checks,
  using runtime timers to resume once every current registration is satisfied.
- `RuntimeTimers.ts` implements `../../types/timers.ts` with owned timeout and
  interval handles, cooldown, disposal, and safe error reporting.
- `taskCancellation.ts` owns journal-scoped caller signals and abort controllers.
  The task composer and cancellation-aware middleware use these helpers.

## Admission Contracts

- `running` admits work. `paused` rejects runtime/resource callers but lets
  already-active internal sources continue their execution trees.
- `coolingDown` still admits work while resources stop their producers.
  `disposing` and `aborting` reject runtime callers, admit allowlisted resource
  sources, and admit active internal sources only.
- `drained` and `disposed` reject ordinary work. Lifecycle event bypass is an
  explicit internal option, not a general escape hatch.
- Drain accounting counts tasks and events; hooks and middleware track active
  internal sources without adding independent business-work counters.
- Balance all tracking in `finally` and clear drain-waiter timers on completion.

## Cancellation, Recovery, And Timers

- A forwarded journal shares one cancellation tree. Caller signals form a
  stack; each call must remove its signal and release tracking on completion.
- Plain tasks do not force-create an abort controller. They still participate
  in drain; cooperative shutdown abort applies once a controller exists.
- Signal links can install listeners; the caller owns their `cleanup()`.
- Recovery checks belong to one pause episode. New episodes, resume, and
  disposal cancel registrations; failed checks are reported and remain false.
- Intervals schedule after the previous callback settles, avoiding overlap.
  Cooldown rejects new timers; disposal cancels existing handles idempotently.

## Tests

- `../../__tests__/models/runtime/LifecycleAdmissionController.test.ts`
- `../../__tests__/models/runtime/RuntimeRecoveryController.test.ts`
- `../../__tests__/models/runtime/RuntimeTimers.test.ts`
- `../../__tests__/run/run.shutdown-drain-abort.test.ts`
- `../../__tests__/run/run.execution-context.signal-inheritance.test.ts`
- `../../__tests__/globals/timeout.middleware.test.ts`

Use fake timers where appropriate and include nested execution and concurrent
runtime cases when changing admission or cancellation. Run QA for source edits.
