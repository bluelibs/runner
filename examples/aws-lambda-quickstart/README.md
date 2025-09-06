AWS Lambda QuickStart with BlueLibs Runner

This example shows two deployment styles using Runner:

- Lambdalith: one Lambda handles all REST routes
- Per-route: each REST endpoint has its own Lambda

The code in `src/` is imported by the repository tests. In a standalone app you'd import from `@bluelibs/runner` instead of using a relative path.

Files
- `src/bootstrap.ts`: shared resources, tasks, and cached runner instance
- `src/handler.lambdalith.ts`: single handler that routes by method/path
- `src/handlers/getUser.ts`: per-route handler for GET /users/{id}
- `src/handlers/createUser.ts`: per-route handler for POST /users

Notes
- Uses request-scoped context via `createContext`
- Disables shutdown hooks for Lambda (`shutdownHooks: false`)
- Keeps a cached runner between warm invocations

