# @runner-examples/tunnel-app

Small, end-to-end tunnel demo that proves Runner tasks can be executed in another
process/runtime over HTTP, while the caller still uses *typed* task dependencies.

What this example demonstrates:

- **Server-side** allow-listing of reachable task ids (`globals.tags.tunnel` in `mode: "server"`).
- **Node exposure** via `nodeExposure` (`POST /__runner/task/:id`).
- **Client-side** routing via a tunnel resource (`globals.tags.tunnel` in `mode: "client"`).
- **Phantom tasks** (`r.task.phantom(...)`) as typed placeholders for remote execution.
- **Auth token** for tunnel requests (`RUNNER_EXAMPLE_TOKEN`).

## Install

```bash
cd examples/tunnels/tunnel-app-example
npm install
```

Notes:

- This example depends on the local repo package via `@bluelibs/runner: file:../../..`.
- If you haven’t built the repo recently, run `npm run build` from the repo root.

## Run

```bash
npm run start
```

This will:

- Start a **SERVER runtime** that owns in-memory state (notes + audits) and exposes allow-listed tasks via `nodeExposure`.
- Start a **CLIENT runtime** that calls phantom tasks; the tunnel middleware routes them over HTTP.
- Log server-side mutations and verify `Date` round-tripping.

## Test

In-memory (no HTTP, always runs):

```bash
npm test
```

Networked (real HTTP + `nodeExposure`):

```bash
npm run test:net
```

If you see `listen EPERM: operation not permitted 127.0.0.1`, your environment
is blocking local socket binds (common in hardened sandboxes). Run the net test
in a normal shell/CI environment that allows binding to localhost.

## Environment Variables

- `RUNNER_EXAMPLE_TOKEN` (default: `dev-secret`): shared token for server exposure and client calls.
- `RUNNER_TEST_NET=1`: enables the real HTTP integration test (`npm run test:net`).

## File Layout

- `src/server/*`: server state + tasks + `nodeExposure` allow-list policy
- `src/client/*`: phantom tasks + tunnel client resource + demo task
- `src/example.ts`: orchestration helpers used by `src/index.ts` and tests
- `src/tunnel-app-example.test.ts`: memory test + opt-in net test

## Why `moduleResolution: Node16`

Runner uses package `exports` and separate entrypoints (`@bluelibs/runner` vs `@bluelibs/runner/node`).
TypeScript needs Node16 resolution to correctly resolve types through `exports`.

```bash
npm run test
```

This runs the in-memory tunnel test (no HTTP).

To run the real networked tunnel test (HTTP + `nodeExposure`):

```bash
RUNNER_TEST_NET=1 npm run test
```
