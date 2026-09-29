# Node Runtime Extensions

## Scope And Maintenance

This tree adds Node-only capabilities to the portable framework. Follow the root
`AGENTS.md`; keep Node dependencies out of universal/browser/edge entry points.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Start Here

- `index.ts` bridges to `node.ts`, the Node public entry point.
- `node.ts` re-exports `../public.ts`, adds Node resources/tags, and registers Node RPC HTTP presets.
- Built-in resources include shell, resilience, durable support, workflow backends, and Redis caching.
- Check `../../package.json`, `../../config/tsup/`, and `../../readmes/MULTI_PLATFORM.md` before changing exports.

## Directory Map

- [durable/AGENTS.md](durable/AGENTS.md): persisted workflow execution, replay, timers, signals, and operators.
- [shell/AGENTS.md](shell/AGENTS.md): local Unix socket access to a running app.
- [resilience/AGENTS.md](resilience/AGENTS.md): shared Redis rate limits, circuits, and concurrency permits.
- [cache/AGENTS.md](cache/AGENTS.md): Redis cache provider and invalidation bookkeeping.
- [queue/AGENTS.md](queue/AGENTS.md): shared in-memory and RabbitMQ queue machinery used by durable and event lanes.
- [event-lanes/AGENTS.md](event-lanes/AGENTS.md): asynchronous event transport and routing.
- [rpc-lanes/AGENTS.md](rpc-lanes/AGENTS.md): remote task/event bindings and HTTP presets.
- [remote-lanes/AGENTS.md](remote-lanes/AGENTS.md): shared lane helpers used by RPC and event lanes.
- [exposure/AGENTS.md](exposure/AGENTS.md): HTTP server request handling, authentication, and multipart ingestion.
- [http/AGENTS.md](http/AGENTS.md): smart and mixed Node HTTP clients.
- [files/AGENTS.md](files/AGENTS.md): Node input files and stream/buffer utilities.
- `upload/manifest.ts`: file discovery and upload manifests; use the file/HTTP guides above for transport context.
- `platform/createFile.ts`: constructs the file sentinel carrying the private Node stream/buffer source.
- [__tests__/AGENTS.md](__tests__/AGENTS.md): mirrored Node tests and infrastructure gating.

## Boundary Contracts

- Runtime state belongs to each `run(app)` instance, resource, or explicit backend namespace.
- Keep connections, timers, async context, queue consumers, and listeners lifecycle-owned.
- Sharing backend state requires an explicit namespace/prefix/queue identity; never derive it from a shortened id.
- Distinguish definition/local ids, canonical runtime ids, durable storage identities, and display labels.
- Optional Redis/RabbitMQ loading lives in `durable/optionalDeps/`; retain fail-fast missing-dependency behavior.
- `platform/createFile.ts` returns a sentinel, not the full `InputFile` implementation; `files/` supplies that behavior.

## Verification

For code changes, run focused mirrored Node tests and root `npm run qa`.
Changes to public exports also need the entry-point and consumer checks included in QA.
For guide-only changes, verify paths/contracts without running QA, per the root exception.
