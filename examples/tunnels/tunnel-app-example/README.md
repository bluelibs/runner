# @runner-examples/tunnel-app

End-to-end `rpcLanes` demo that proves Runner tasks can execute in another runtime
over HTTP while callers keep typed task dependencies.

What this example demonstrates:

- Server-side lane serving via `rpcLanesResource` (`profile: "server"`).
- Client-side remote routing via `rpcLanesResource` (`profile: "client"`).
- HTTP RPC communication through `r.rpcLane.httpClient`.
- Remote task placeholders that fail-fast if lane routing is not active.
- JWT lane auth (`binding.auth`) plus HTTP exposure auth (`exposure.http.auth`).

## Install

```bash
cd examples/tunnels/tunnel-app-example
npm install
```

## Run

```bash
npm run start
```

This starts:

- A server runtime that owns in-memory state (notes + audits) and serves lane-assigned tasks.
- A client runtime that calls placeholder tasks; `rpcLanes` routes them over HTTP.

## Test

In-memory (no HTTP socket bind):

```bash
npm test
```

Networked (real HTTP exposure):

```bash
npm run test:net
```

If you see `listen EPERM: operation not permitted 127.0.0.1`, your environment
blocks local socket binds. Run network tests in an environment that allows localhost binding.

## Environment Variables

- `RUNNER_EXAMPLE_TOKEN` (default: `dev-secret`): shared secret used for exposure auth and lane JWT.
- `RUNNER_TEST_NET=1`: enables real HTTP integration test (`npm run test:net`).

## File Layout

- `src/server/*`: server state + served lane tasks + rpc lanes exposure wiring.
- `src/client/*`: remote placeholders + communicators + client task orchestration.
- `src/example.ts`: orchestration helpers for CLI and tests.
- `src/tunnel-app-example.test.ts`: in-memory and optional network integration tests.
