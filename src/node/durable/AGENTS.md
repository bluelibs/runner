# Durable Workflows

## Scope And Maintenance

This module persists workflow progress so execution can resume after waits,
retries, process restarts, and operator actions. Follow the Node and root guides.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Read In This Order

1. `index.ts` for the public surface and `core/interfaces/` for backend/runtime contracts.
2. [core/AGENTS.md](core/AGENTS.md) for execution, replay, admission, and lifecycle ownership.
3. [store/AGENTS.md](store/AGENTS.md) for memory/file/Redis persistence and atomic operations.
4. `resources/memoryDurableResource.ts` or `resources/redisDurableResource.ts` for Runner wiring.
5. `../../../readmes/DURABLE_WORKFLOWS_AI.md` for usage; the longer guide is `DURABLE_WORKFLOWS.md` alongside it.

## Directory Map

- `core/`: service/resource/context/operator facades, typed interfaces, and focused managers.
- `store/`: durable records, indexes, waiters, schedules, snapshots, and lock ownership.
- `queue/`: memory and RabbitMQ execution delivery; delegates shared transport to `../queue/`.
- `bus/`: memory, Redis pub/sub, and no-op wakeup notifications.
- `resources/`: built-in backend composition, isolation defaults, and shutdown abort hook.
- `tags/`: workflow key/admission/signal metadata and durable runtime discovery.
- `emitters/` and `events.ts`: translate audit records into Runner events.
- `optionalDeps/`: lazy access to Redis/RabbitMQ dependencies.
- `test-utils.ts`: disposable durable test setup and bounded polling helper.

## Contracts To Preserve

- Durable `workflowKey` is a persistence identity: tags may override the canonical task id.
  `core/managers/TaskRegistry.ts` resolves compatibility aliases and rejects collisions.
- Execution, step, signal, timer, schedule, and lock ids have separate roles; preserve exact identities.
- `resources/isolation.ts` encodes the complete namespace into default Redis prefixes and queue names.
- Memory backends own state per instance. File persistence is for one process; Redis supports shared backend state.
- Step `concurrency` derives pools from persisted workflow key + explicit step ID or an explicit shared key; full pools durably suspend and free workflow admission.
- Store records determine correctness; bus messages wake waiters and do not replace durable state.
- Queue creation and queue consumption are separate settings; built-ins consume only with `queue.consume: true`.
- Runner integration owns an `AsyncLocalStorage` per durable runtime, not one process-wide workflow context.
- Cooldown stops admission/consumers before disposal drains and tears down backends.
- Audit emission is best effort and must not change workflow correctness.

## Tests And Acceptance

Tests mirror this tree in `../__tests__/durable/`; start with `core/service/`,
`core/lifecycle/`, and `store/` for behavioral changes. Backend wiring tests are
in `../__tests__/durable/resources/`. Verify replay after a wait/restart, lifecycle
races, persistence identity, and isolation for the affected contract.
Run focused tests before root QA for code changes; guide-only edits use the root docs exception.
