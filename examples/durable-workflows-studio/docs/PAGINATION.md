# Progressive Pagination

## Contract

Execution lists use `DurableOperator.listExecutionStates`, with 40 rows per
request and an opaque cursor. The built-in MemoryStore and RedisStore maintain
sorted metadata indexes for workflow, status, and combined filters. Lists and
exact-ID lookups do not deserialize workflow inputs, results, steps, or audit
trails. Ordering is creation time descending, then exact execution ID ascending.

The browser retains ten execution pages (400 summaries), virtualizes mounted
rows, and fetches older pages only on demand. Evicted newer pages can be fetched
again. Automatic head polling pauses while browsing history; Refresh returns to
the newest page. Query changes discard stale in-flight responses. Failed page
requests expose Retry rather than an automatic scroll-triggered retry loop.

Workflow catalogs use server-side search and 20-item pages. Sidebar and pickers
retain at most 200 catalog entries, with previous-page navigation; the sidebar
also virtualizes rows. Search appears when the catalog contains more than five
types. Catalog cursors assume registrations remain unchanged during a session.

Execution search is **exact execution ID**, across the whole history. Workflow
names are searched in the workflow picker. Arbitrary payload/step-text search
is deliberately not advertised: that would require a separate search index.

The dashboard labels aggregates as loaded-window statistics. It does not fetch
all executions to compute global charts or totals. The stuck preview is also
bounded to 40 indexed summaries. Schedules, explicit recovery actions,
detail timelines, and the legacy explicit-offset API remain separate
surfaces; this change does not make those unbounded legacy operations scalable.

## Redis Upgrade

Fresh writes update execution payload, status sets, metadata and sorted indexes
in one Lua operation. Existing installations need a one-time resumable backfill:

```ts
// Given your configured durable runtime; use a trusted maintenance process.
let cursor: string | undefined;
do {
  const page = await durable.operator.rebuildExecutionIndex({ cursor, limit: 500 });
  cursor = page.nextCursor ?? undefined;
  // Persist cursor between batches if the maintenance process may restart.
} while (cursor);
```

Redis `SSCAN COUNT` is a work hint, not a strict batch-size guarantee. Backfill
uses compare-and-set so concurrent execution writes win. Indexed listing fails
explicitly while metadata is incomplete; it never falls back to downloading
the entire execution store. Custom stores without the optional indexed
capabilities retain the legacy operator fallback and must supply their own
indexed implementations for equivalent performance. File-backed
PersistentMemoryStore still serializes snapshots and is intended for local/dev,
not high-throughput production writes.

## Acceptance Checks

- [x] Traverse 100,000 stored executions without duplicate IDs or payload reads.
- [x] Select 20 active executions across 50 workflow types through indexes.
- [x] Keep cursors stable after new executions are inserted.
- [x] Retain at most 400 execution summaries while reaching result 100,000.
- [x] Search a 100,000-type catalog beyond its first 99,999 entries.
- [x] Verify real Redis writes, filtered pages, idempotency and backfill.
- [x] Exercise the live HTTP UI with 100,000 executions and bounded responses/DOM.
- [x] Final framework QA, example tests, typecheck, and screenshot review.

Run `npm run shots` in the example for browser checks. Screenshots 19 and 20
use the real API and indexed MemoryStore with inspection-only fixtures: 50
catalog types, 100,000 executions, 20 active. These fixtures do not launch
100,000 workflow workers. Generated PNGs remain ignored by Git.

For real Redis, build the root package and run
`node scripts/verify-durable-pagination.mjs` from the repository root. It starts
and cleans up an isolated temporary Redis instance (`redis-server` on PATH),
seeds 100,000 executions, traverses them, and reports local page timings.
