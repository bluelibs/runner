# Shared Resilience Contracts

## Scope And Maintenance

This directory defines the platform-neutral contract used by concurrency,
rate-limit, and circuit-breaker middleware. Redis execution belongs in
`../../node/resilience/`; keep transport and Redis clients out of this directory.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Entry Points

- `types.ts` defines configuration, distributed semaphore handles, rate
  admissions, circuit snapshots/tokens, and the `Resilience` backend interface.
- `resource.ts` supplies the dependency identity and shared config schema.
  Its shared-platform initializer throws because Redis needs the Node entry.
- `coordination.ts` defines optional `local`/`distributed` configuration.
- `concurrencyKey.ts` builds keys shared by named semaphore handles and keyed
  concurrency middleware.
- `circuit.ts` runs backend circuit admission/settlement and synchronizes
  middleware journal state.
- `errors.ts` defines the typed resilience failure contract.
- `../../models/validators/ResilienceCoordinationValidator.ts` rejects invalid
  backend requirements during startup.

## Contracts To Preserve

- Resilience is opt-in and absent from automatic builtins. The Node resource
  provides the backend; adding a global registration would change policy defaults.
- Omitted coordination uses registered resilience when available, otherwise
  memory. `local` always uses memory; `distributed` must have a backend.
- Backend failure must propagate rather than silently switching a distributed
  policy to memory and breaking cross-replica limits.
- Namespace separates environments; full canonical task/application identities
  and identity namespaces separate policy partitions.
- `sharedConcurrencyKey()` must keep direct semaphore handles and middleware
  addressing the same intended pool.
- Circuit admissions carry generation tokens so stale outcomes cannot mutate
  a newer circuit generation. Permits and half-open probes have lease ownership.
- Disposal stops owned work and closes the connection without clearing shared
  state. Cancellation and ownership-loss behavior are backend contracts.

## Tests

- `../../__tests__/globals/resilience/coordination.test.ts` covers selection,
  missing-backend startup failures, and explicit semaphore restrictions.
- `../../__tests__/globals/resilience/middleware.test.ts` covers backend calls.
- `../../node/__tests__/resilience/resource.test.ts` covers the Node resource.
- `../../node/__tests__/resilience/coordination.integration.test.ts` and
  `concurrency.integration.test.ts` beside it exercise distributed behavior.

Use mocked shared tests for contract edits and appropriate Node tests for backend
changes. Follow the Node test prerequisites and run QA for source changes.
