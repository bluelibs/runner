# Node Test Map

## Scope And Maintenance

These tests mirror `../` Node implementations. Root tests in `../../__tests__/`
cover portable behavior and provide the shared Jest setup.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Where To Start

- `durable/core/service/`: workflow orchestration, queue roles, recovery, result waiting, and cross-worker step concurrency (live Redis uses `DURABLE_TEST_REDIS_URL`).
- `durable/core/lifecycle/`: pause, resume, cancel, restart, continuation, and workflow state replay.
- `durable/core/managers/`: lock/admission ownership, timer polling, transitions, and signal races.
- `durable/core/durable-context/`, `durable/core/audit/`: replayable actions and observability.
- `durable/store/`: memory/file/Redis parity, snapshots, indexes, waiters, and atomic mutation.
- `durable/resources/`, `durable/helpers/`: Runner backend wiring and shared focused helpers.
- `durable/bus/`, `durable/queue/`, `durable/tags/`, `durable/emitters/`: adapter and discovery contracts.
- `shell/`: socket safety, handshake, native REPL, read-only scope, app isolation, and shutdown.
- `resilience/`: policy identity, cancellation, permit leases, local/distributed coordination.
- `cache/`: Redis provider ownership, invalidation, shared budgets, and bookkeeping.
- `queue/`: shared memory loop and mocked RabbitMQ transport recovery.
- `event-lanes/`, `rpc-lanes/`, `remote-lanes/`: lane routing, bindings, identity propagation, and transport behavior.
- `exposure/`: HTTP request handlers, auth, CORS, lifecycle, multipart, and response streams.
- `http/`, `files/`, `upload/`: Node clients, input-file utilities, and upload manifests.
- `core/`, `exports/`: Node entry-point and built-in resource contracts.
- `type-tests/durable/`: compile-time workflow/resource/lifecycle contracts (`*.type-test.ts`, not Jest suites).

## Test Contracts

- Test the public behavior and failure outcomes; use targeted internal tests for races and ownership.
- Keep each `run(app)` isolated; dispose runtimes/backends, remove temporary files, and close sockets.
- Preserve canonical runtime addressing versus durable persistence/delivery identities in fixtures.
- Use bounded condition polling (`durable/test-utils.ts`) where state transitions are asynchronous.
- Shell `helpers.ts` supplies Unix/platform and terminal helpers; retain those gates.
- Real Redis/RabbitMQ suites are opt-in and have per-suite environment gates.
  Read the suite header before running; a skipped infrastructure suite is not live-backend verification.
- Resilience live Redis tests use `RESILIENCE_REDIS_URL`.
- Durable real-store fault tests use `REAL_INFRASTRUCTURE_FAULT_INTEGRATION=1`
  plus `REAL_INFRASTRUCTURE_REDIS_URL` or `DURABLE_TEST_REDIS_URL` (see suite defaults).
- Keep mocks representative of the backend contract; atomicity still needs real infrastructure when relevant.

## Running And Reviewing

`../../../config/jest/jest.config.js` discovers `src/**/*.test.ts`, installs the
root Jest setup, and excludes test code from coverage collection.
Use root `npm run test -- <searchKey>` for focused code checks; root `npm run qa`
is required for code changes. Do not loosen coverage or hide production files.
Docs-only guide changes follow the root no-QA exception; validate references instead.
