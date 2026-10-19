# Durable Event Bridge

This Node integration replaces selected EventManager dispatch with one registered durable workflow task. Keep ordinary event callers on the normal emission APIs.

## Ownership

- `resource.ts` owns one run's routes, backend discovery, submission, and parent linkage.
- `plan.ts` validates eligible definitions, exact hook membership, and competing remote routes.
- `execute.ts` replays persisted hook receipts and the separate compensation phase.
- `validation.ts`, `types.ts`, and `tag.ts` define the public configuration boundary.
- `wait.ts` cancels a caller's wait without cancelling accepted durable work.

## Contracts

Compile routing from canonical definitions and visibility. Tag startup dependencies can be discovered before their values initialize; resolve backend values when dispatch is admitted after initialization. Preserve hook execution through Runner admission, DI, and interceptors.

Parent emission checkpoints use the per-Runner context stack across durable resources. Automatic child identity must survive replay. Persist ordered hook identities; replay that membership and order using current implementations, without event versions. Added hooks affect new emissions only. Missing or retargeted saved hooks fail before effects; compensation handlers must accept older receipts.

Compensation phase and undo checkpoints survive recovery independently of forward execution. Keep business errors and undo errors, including cancellation races; pause/shutdown interruptions must park work. Hook bodies cannot suspend or continue as new. History collection belongs to the core and store modules.

## Tests

Run mirrored `../../__tests__/durable/bridge/` and `resources/durableEventBridge*` suites, including startup recovery, queue mode, cancellation, cross-backend parent IDs, and replay deduplication. Public compensation receipt inference is checked in `src/__tests__/type-tests/builders/hook-compensation.type-test.ts`. Run root QA for changes.
