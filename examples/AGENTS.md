# Consumer Examples

> **Keep This Guide Current:** If you make changes within this directory, update this `AGENTS.md` in the same change whenever responsibilities, entry points, contracts, or test guidance change. Keep it concise and accurate; do not make artificial edits when the guidance still holds.

## Scope

Examples are separate consumer apps and demonstrations, not framework implementation. Start with [README.md](README.md), then the chosen example's README, package scripts, and any nearer `AGENTS.md`.

## Map

- [ask-runner/AGENTS.md](ask-runner/AGENTS.md): Express app for Runner questions, streaming, budgets, and task middleware.
- [fastify-mikroorm/AGENTS.md](fastify-mikroorm/AGENTS.md): Fastify/PostgreSQL service with tagged task routes and ORM lifecycle.
- `express-openapi-sqlite/`: Express, generated OpenAPI routes, and SQLite.
- `aws-lambda-quickstart/`: thin Lambda ingress, warm-runtime bootstrap, and serverless deployment templates.
- `durable-workflows/`: runnable workflows, signals, checkpoints, and scale examples; `agent-orchestration/` demonstrates review loops and broker-backed orchestration.
- `durable-workflows-studio/`: operations dashboard, shared server/client contracts, Node REST/SSE API, React web client, and demo simulator.
- `tunnels/`: lane examples for RPC, authentication, and streams.
- `runtime/`: Bun/Deno consumer entry points; `local-shell/`: Node app and shell connector scripts.
- `cache/`, `test-with-module/`, and standalone TypeScript examples: focused overrides, consumer testing, interceptors, and schema integration.

## Contracts To Preserve

- Local `file:...` dependencies consume this repository's built package. Build at the repository root before installing/testing a consumer; use each example's own scripts and configuration.
- Root Jest/typecheck do not validate every separate example. Inspect that example's package scripts to choose its tests/build; Node test, Jest, and web Vitest suites coexist here.
- Example lockfiles are intentionally ignored; do not introduce tracked generated builds, dependencies, local databases, or environment secrets.
- HTTP adapters translate ingress/response behavior; tasks own business actions; resources own services; middleware owns reusable task policy.
- Use typed local IDs in newly authored definitions and canonical/storage identity for stateful framework integration.
- Keep broker/database requirements and demo mode explicit. In-memory demos and real services have different validation setups.

## Validation

For app changes, run the chosen example's documented tests/build and update its README when visible behavior changes. If framework code also changes, run repository `npm run qa`. Contributor-docs-only changes need reference checks, not app startup or full QA.
