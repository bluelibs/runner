# Redis Resilience Coordination

## Scope And Maintenance

Node resilience adds opt-in shared Redis state for middleware rate limits,
circuit breakers, and concurrency. Portable interfaces live in `../../globals/resilience/`.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Entry Points And Layout

- `resource.ts`: keeps portable resource identity while supplying Node initialization.
- `RedisResilience.ts`: backend facade, policy keys, runtime-local waiters, active operations, and disposal.
- `scripts.ts`: atomic Redis operations for rate, circuit, and permit state.
- `acquirePermit.ts`: admission retries, queue accounting, and wait deadlines.
- `acquireLease.ts`: cancellation-safe acquisition and late-grant cleanup shared with durable steps.
- `permit.ts`: Redis permit acquisition, owned callbacks, and shutdown.
- `renewableLease.ts`: backend-independent renewal/deadline/completion checks shared with durable admission.
- `semaphore.ts`: validates and snapshots a named semaphore's policy before producing its handle.
- `../node.ts`: installs this resource into Node built-ins without replacing portable global state.

## Identity And Ownership Contracts

- Derive Redis keys from namespace, feature, and complete policy identity.
  The hash tag keeps a policy's keys in one Redis Cluster slot.
- Preserve canonical task/pool identities and identity scope; do not group by shortened ids.
- Redis namespaces intentionally share policy state; conflicting limits in the same identity fail.
- Local waiting counts belong to this backend instance; remove entries when queues drain.
- Semaphore handles own configuration; the backend owns permits, waiters, and shutdown.
- Cancellation returns promptly even when Redis acquisition stalls; release any late grant.
- Acquired permits have conservative local deadlines, renewal, and final ownership verification.
- Lease loss or stalled renewal aborts work cooperatively and prevents a successful owned result.
- Circuit settlement carries the admission generation so stale outcomes cannot corrupt newer state.
- Disposal aborts permit ownership, settles tracked work, then disconnects the owned client.
- Resource init validates/connects/pings the client and disconnects it if startup fails.
- Redis transport failures propagate; preserve the configured fail-fast client options.

## Tests And Acceptance

Mirrored tests are in `../__tests__/resilience/`.
`acquirePermit.test.ts` and `permit.test.ts` cover cancellation and lease races;
`backend.test.ts`, `semaphore.test.ts`, and `resource.test.ts` cover policy and resource behavior.
`composition.integration.test.ts` checks wiring; shared-coordination and live Redis suites
read `RESILIENCE_REDIS_URL` and may skip when it is absent.
For code changes test cancellation before/after grants, ownership loss, disposal,
namespace isolation, and intentional shared coordination as affected, then run root QA.
