# AWS Lambda QuickStart with BlueLibs Runner

Quick serverless integration for API Gateway and AWS Lambda:

```bash
# Start it with serverless
npm run dev

# Start with AWS SAM
npm run dev:sam

# Run the local verification flow
npm run check
```

This example shows two deployment styles using Runner:

- **Lambdalith**: one Lambda handles all REST routes
- **Per-route**: each REST endpoint has its own Lambda

It also shows the Runner patterns that matter in Lambda:

- cache `run(app)` across warm invocations
- provide request metadata at ingress with `RequestCtx.provide(...)`
- validate business input at task level with `.inputSchema(...)`
- fail fast when request context is missing via `RequestCtx.require()`
- keep a `disposeRunner()` escape hatch for tests and local scripts

The code in `src/` is imported by the repository tests. In a standalone app you'd import from `@bluelibs/runner` instead of using a relative path.

## Files

- `src/bootstrap.ts` — shared resources, tasks, and cached runner instance
- `src/http.ts` — shared HTTP utilities (CORS, JSON responses, event parsing)
- `src/lambda.ts` — shared Lambda request-context wiring for handlers
- `src/handler.lambdalith.ts` — single handler that routes by method/path
- `src/handlers/getUser.ts` — per-route handler for GET /users/{id}
- `src/handlers/createUser.ts` — per-route handler for POST /users
- `src/validation.ts` — HTTP-friendly formatting for validation failures

## Notes

- API Gateway already owns HTTP ingress, so the Lambda handler only adapts the event into `runtime.runTask(...)`.
- Uses request-scoped async context via `r.asyncContext(...)`, not global mutable state.
- Disables shutdown hooks for Lambda (`shutdownHooks: false`).
- Keeps a cached Runner runtime between warm invocations.
- Task schemas own business validation, while the handler maps validation failures back to HTTP 400 responses.
- All handlers share HTTP utilities from `http.ts` and Lambda wiring from `lambda.ts` to avoid duplication.
