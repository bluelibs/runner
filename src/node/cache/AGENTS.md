# Redis Cache Provider

## Scope And Maintenance

This adapter implements the portable cache contracts in
`../../globals/middleware/cache/`. Keep middleware policy there and Redis storage here.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Entry Points

- `index.ts`: exported adapter/configuration surface.
- `redisCacheProvider.resource.ts`: validates config/client, selects serializer, and produces per-task caches.
- `redisCache.ts`: payloads, references, size bookkeeping, LRU indexes, and eviction.
- `../node.ts`: adds the provider to Node built-ins.
- `../durable/optionalDeps/ioredis.ts`: lazy client creation shared with other Node adapters.

## Storage And Lifecycle Contracts

- The default prefix contains a fresh UUID per provider initialization, preserving app isolation.
  A caller-specified prefix intentionally selects shared backend state.
- Each task token hashes the complete supplied task id; each entry also hashes its cache key.
- Reference indexes are task-scoped; shared-budget eviction must unlink the evicted task's references.
- Per-task member/LRU/byte indexes and provider-wide LRU/byte indexes must stay consistent.
- `clear()` targets one task cache; total-budget eviction can remove another task's entries.
- Key/ref normalization uses the portable helpers; do not invent different adapter semantics.
- Payloads pass through the configured serializer; missing/corrupt payloads clean tracked metadata.
- TTL supports Redis `setex` or `SET PX`, preserving millisecond options and required conversion.
- Max-entry, max-count, max-size, and total-budget constraints retain their distinct meanings.
- Replacing an entry adjusts prior references and sizes rather than double-counting them.
- Batched hash reads use `hmget` when available and fall back to individual `hget` calls.
- Dispose only closes a client created by this resource; caller-provided clients remain caller-owned.

## Tests And Acceptance

Tests mirror this directory in `../__tests__/cache/`.
`redisCache.test.ts` covers payload/limit behavior; `redisCache.refs.test.ts`
covers shared-budget cross-task cleanup; `redisCache.invalidate-keys.test.ts`
covers exact-key invalidation; `redisCacheProvider.resource.test.ts` covers wiring/ownership.
For code changes test metadata cleanup as well as cache hits, verify task/prefix
isolation and shared eviction where affected, then run root QA.
