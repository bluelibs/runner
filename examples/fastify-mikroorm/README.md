# fastify-mikroorm

Minimal app built with @bluelibs/runner, Fastify and MikroORM (PostgreSQL). It includes a dev portal (Runner Dev) and a tiny Users feature with a GET /users route, plus simple authentication (register/login, cookie or Bearer).

## What runs where

- Runner Dev portal: http://localhost:1337
  - GraphQL: http://localhost:1337/graphql (introspection, tasks/events, live telemetry)
  - Voyager: http://localhost:1337/voyager
  - Docs: http://localhost:1337/docs
- App HTTP server (Fastify): http://localhost:3000
  - Example route: GET /users
  - Auth routes: POST /auth/register, POST /auth/login, POST /auth/logout, GET /me
  - Health: GET /healthz (liveness)
  - Ready: GET /readyz (DB readiness)
  - Swagger UI: http://localhost:3000/swagger
- MikroORM (PostgreSQL)

## Prerequisites

- Node.js 20+
- PostgreSQL

Quick Postgres (Docker):

```bash
docker run --name runner-pg -e POSTGRES_USER=myuser -e POSTGRES_PASSWORD=mysecretpassword -e POSTGRES_DB=clearspec -p 5433:5432 -d postgres:16
```

Then set `DATABASE_URL` accordingly (see `.env.example`).

## Environment

Copy `.env.example` to `.env` and adjust:

- `NODE_ENV`: `development` | `production`
- `PORT`: Fastify port (default 3000)
- `AUTH_SECRET`: strong secret for HMAC token signing
- `DATABASE_URL`: Postgres connection string (ex: `postgres://myuser:mysecretpassword@localhost:5433/clearspec`)

## Quick start

1. Install deps

```bash
npm install
```

2. Start in dev (Runner Dev + Fastify)

```bash
npm run dev
```

3. Apply DB migrations (first run only)

```bash
npm run db:migrate:up
```

4. Try the API

```bash
curl http://localhost:3000/users
```

## Scripts (package.json)

- dev: Start with tsx watch (Runner Dev on 1337, Fastify on 3000)
- build: Compile TypeScript to `dist`
- start: Run built app (`dist/main.js`)
- test: Run Jest
- test:watch: Run Jest in watch mode
- schema:sdl: Print GraphQL schema SDL via Runner Dev

Prod-ish build/run:

```bash
npm run build
npm start
```

## Database

- ORM: MikroORM (PostgreSQL)
- Config: `src/db/resources/orm.config.ts`
- Migrations: `src/db/migrations` (TypeScript), emitted to `dist/db/migrations`
- Apply migrations: `npx mikro-orm migration:up`

Schema (via migrations) includes `users` and `posts` tables with a relation (`posts.author_id -> users.id`).
Users also have `password_hash` and `password_salt` columns.

Fixtures: The app seeds a few demo users and posts the first time it runs against an empty DB. See `src/db/resources/fixtures.resource.ts`.

Migrations workflow:

```bash
# After changing an Entity schema, emit a migration
npm run db:migrate:create

# Apply migrations
npm run db:migrate:up

# Roll back last migration (if needed)
npm run db:migrate:down
```

## Features in this repo

- HTTP wiring: `src/http` – Fastify instance and router that binds tasks tagged with `httpRoute` to routes
- Security: `@fastify/helmet` and CORS enabled; cookies marked `Secure` in production
- Observability: request `x-request-id` and request-scoped logger; access logs per request
- Users module: `src/users`
  - Task: `GET /users` (`list-all-users.task.ts`) – returns all users from the DB
  - Auth resource: `src/users/resources/auth.resource.ts` – password hashing and stateless HMAC tokens
  - Tasks:
    - `POST /auth/register` – create account, returns token and sets cookie
    - `POST /auth/login` – authenticate, returns token and sets cookie
    - `POST /auth/logout` – clears cookie
    - `GET /me` – get current user (via cookie or Bearer)

## Tasks & HTTP Pattern

This app wires HTTP routes to Runner tasks using a small tag + router pattern:

- Tag HTTP endpoints using `httpRoute`:
  - File: `src/http/tags/http-route.tag.ts`
  - Example: `tags: [httpRoute.with({ method: "post", path: "/auth/login", auth: 'public' })]`
- The Fastify router (`src/http/resources/fastify-router.resource.ts`) does the following:
  - Passes `request.body` as task input by default; set `httpRoute.with({ ..., inputFrom: 'merged' })` to pass `{ ...params, ...query, ...body }`.
  - Provides a single `fastifyContext` so tasks can access `request`, `reply`, `requestId`, request-scoped `logger`, and `user` (when present).
  - Attaches user automatically when a valid token is sent via Cookie or Bearer. Control per-route via `auth`: `public` (default), `optional`, or `required`.
- Builds Fastify route schemas from your Zod `inputSchema`/`resultSchema` and exposes OpenAPI at `/swagger`.
- Global error handling is set in `src/http/resources/fastify.resource.ts`:
  - Throw `new HTTPError(status, message)` from tasks to return proper HTTP codes.
  - Zod/Runner validation errors are returned as `400`.

Common patterns:

- Access request/reply/context:
  ```ts
  const { request, reply, user, requestId, logger } = fastifyContext.use();
  ```
- Validate inputs/outputs with Zod: use `inputSchema` and `resultSchema` in tasks.
- Return consistent errors: throw `new HTTPError(code, message)`.

Each task should define zod schemas:

```ts
export const myTask = task({
  id: "app.feature.tasks.myTask",
  meta: { title: "Do Thing", description: "Explains what it does" },
  tags: [httpRoute.with({ method: "post", path: "/thing" })],
  inputSchema: z.object({ foo: z.string() }),
  resultSchema: z.object({ bar: z.number() }),
  dependencies: { db /*, other resources */ },
  run: async (input, { db }) => {
    const { request, reply } = fastifyContext.use();
    // implement logic, throw new HTTPError(400, "Bad foo") if needed
    return { bar: 123 };
  },
});
```

Notes:

- For GET routes with no body, set `inputSchema: z.undefined()`.
- You can access `request.query`, `request.params`, headers, etc. via `fastifyContext.use()`.
- Prefer returning DTOs (plain objects) matching your `resultSchema` (don’t return ORM entities directly).
- Always include `meta.title` and `meta.description` for AI-friendly docs in Runner Dev.

### Error Handling

- Throw `new HTTPError(status, message)` from tasks for predictable HTTP responses.
- Input validation errors (from `inputSchema`) and other schema violations return 400.
- Unhandled errors fall back to 500.

### Add a new endpoint

1. Create a task file in `src/<feature>/tasks/xxx.task.ts`.
2. Add `inputSchema` and `resultSchema` with zod.
3. Add the `httpRoute` tag with `method` and `path`.
4. Use `fastifyContext` when you need access to `request` or `reply`.
5. Return data adhering to `resultSchema`; throw `HTTPError` for expected errors.

See `src/users/tasks/*.ts` for reference implementations.

## Env & Security

- Copy `.env.example` to `.env` and set values. In production, set a strong `AUTH_SECRET` and ensure you serve over HTTPS (cookies become `Secure`).
- CORS defaults to permissive for development; tighten origins in `fastify.resource.ts` for production.

Cookie/security notes:

- Cookies are `HttpOnly` and `SameSite=Lax`. In production, they become `Secure` (HTTPS required).
- Change cookie name via `auth.resource` config/env (`cookieName`).
- Tokens are signed via HMAC (HS256-like). Rotate `AUTH_SECRET` when needed.

## Health & Readiness

- `GET /healthz` returns `{ status: 'ok' }` for liveness.
- `GET /readyz` returns `{ status: 'ok' }` after a successful DB connectivity check.

## Project layout (high-level)

- src/
  - main.ts – bootstraps Runner with DB, HTTP, Users, and Runner Dev UI
  - db/ – MikroORM entities, config, and migrations
  - http/ – Fastify resource, router, and startup hook
  - users/ – auth resource stub and the list-all-users task
  - users/tasks – auth endpoints (register, login, logout, me)

## Auth Guide

- Tokens: stateless HMAC-signed tokens (JWT-like) using Node `crypto` (no extra deps).
- Transport: works with either:
  - HTTP-only cookie `auth=...` (default) – sent back on register/login
  - `Authorization: Bearer <token>` header

### Endpoints

- POST `/auth/register`
  - Body: `{ name: string, email: string, password: string }`
  - Returns: `{ token, user: { id, name, email } }`
  - Sets: `Set-Cookie: auth=<token>; HttpOnly; Path=/; Max-Age=...`

- POST `/auth/login`
  - Body: `{ email: string, password: string }`
  - Returns: `{ token, user: { id, name, email } }`
  - Sets: `Set-Cookie: auth=<token>; ...`

- POST `/auth/logout`
  - Returns: `{ success: true }`
  - Sets: `Set-Cookie: auth=; Max-Age=0; ...`

- GET `/me`
  - Auth: via cookie or `Authorization: Bearer <token>`
  - Returns: `{ id, name, email }`

### Curl examples

Register:

```bash
curl -X POST http://localhost:3000/auth/register \
  -H 'content-type: application/json' \
  -d '{"name":"Ada","email":"ada+new@example.test","password":"s3cret"}' -i
```

Login:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"ada+new@example.test","password":"s3cret"}' -i
```

Me with Bearer:

```bash
TOKEN="<copy from login>"
curl http://localhost:3000/me -H "Authorization: Bearer $TOKEN"
```

Me with Cookie:

```bash
COOKIE="<copy Set-Cookie header value up to first ;>"
curl http://localhost:3000/me -H "Cookie: $COOKIE"
```

### Configuration

`auth.resource` reads config and env:

- Secret: `AUTH_SECRET` env var (default: `dev-secret-change-me`)
- Token lifetime: 7 days (configurable via resource)
- Cookie name: `auth` (configurable via resource)

See `src/users/resources/auth.resource.ts` for details.

### Seeded users

Fixtures create a few demo users with password `password` and hashed/salted credentials:

- Ada Lovelace – `ada@example.test`
- Alan Turing – `alan@example.test`
- Grace Hopper – `grace@example.test`

You can log in with any of the above using `password`.

Behind the scenes:

- `register`, `login`, `logout`, and `me` are implemented as Runner tasks with strict `inputSchema`/`resultSchema`.
- `register` and `login` set an HTTP-only cookie using `fastifyContext`.
- `me` extracts the auth token from either the cookie or the `Authorization` header.

### Authorization middleware (roles)

This project includes a Runner task middleware to enforce authorization based on presence of a user and optional roles:

- File: `src/http/middlewares/authorize.middleware.ts`
- Usage: `middleware: [authorize.with({ roles: ["admin"] })]`
- Example: `GET /users` requires an authenticated user and `role=admin`.

Role detection prefers `fastifyContext.use().user?.role`; if not present, it falls back to the `x-user-role` header. Since the demo DB schema does not include roles, you can provide the role via header when testing.

Example call (using Bearer token and header role):

```bash
TOKEN="<copy from login>"
curl http://localhost:3000/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-user-role: admin"
```

Requests with a missing user return 401; with a non-allowed role return 403.

API endpoints overview:

| Method | Path           | Auth                 | Description                                |
| ------ | -------------- | -------------------- | ------------------------------------------ |
| GET    | /users         | Required + admin     | List all users (admin-only)                |
| POST   | /auth/register | Public               | Create user, returns token + sets cookie   |
| POST   | /auth/login    | Public               | Authenticate, returns token + sets cookie  |
| POST   | /auth/logout   | Public               | Clears auth cookie                         |
| GET    | /me            | Required             | Current user info                          |
| GET    | /healthz       | Public               | Liveness probe                             |
| GET    | /readyz        | Public               | DB readiness check                         |

Extending roles (optional): If you want persistent roles, add a `role` property to the `User` entity + migration, and include it in the `user` object built in the router (`fastify-router.resource.ts`).

Example snippet:

```ts
// In User entity schema:
role?: string; // add and migrate

// In fastify-router.resource.ts when attaching user:
user = { id: entity.id, name: entity.name, email: entity.email, role: entity.role };
```

## Runner Dev tips

- Explore tasks/events and live docs at http://localhost:1337/docs
- Query the dev GraphQL endpoint:

```bash
ENDPOINT=http://localhost:1337/graphql npx runner-dev query 'query { tasks { id } }' --format pretty
```

- Print the GraphQL schema SDL:

```bash
npm run schema:sdl
```

## Testing

```bash
npm test
```

Tests cover DB, HTTP router, boot, and auth flows (register → me → bad login → login → logout).

Additional tests validate the authorization middleware:

- `src/http/authorize.middleware.test.ts` verifies 401/403/200 responses for `/users` under different auth/role conditions.

Run a single test file:

```bash
npx jest src/http/authorize.middleware.test.ts
```

Jest uses the in-memory SQLite harness in `src/test/utils.ts` so tests are fast and hermetic.

Watch mode:

```bash
npm run test:watch
```

## Troubleshooting

- DB connection errors: ensure PostgreSQL is running on `localhost:5433` and the database `clearspec` exists, or update the URL in `src/db/resources/orm.config.ts`.
- Port conflicts: Runner Dev uses 1337, Fastify uses 3000 (see `src/http/hooks/onReady.hook.ts`).
 - Missing middleware/resource errors in tests: ensure you register any task middlewares and resources used by your tasks within the test harness' `register` list.

## Docs sync (optional)

This project includes a helper to sync Runner docs into local `readmes/` for AI-friendly browsing.

```bash
npx ts-node scripts/sync-docs.ts
```

This refreshes:

- `readmes/runner-AI.md`
- `readmes/runner-README.md`
- `readmes/runner-dev-AI.md`

## Common Tasks

- Create a new HTTP endpoint
  1) Create a task in `src/<feature>/tasks/xxx.task.ts`
  2) Add `inputSchema` and `resultSchema`
  3) Tag it: `httpRoute.with({ method, path, auth })`
  4) Register the task in the feature `index.ts`

- Add middleware to a task
  ```ts
  import { authorize } from "../../http/middlewares/authorize.middleware";
  export const myTask = task({
    id: "app.feature.tasks.myTask",
    middleware: [authorize.with({ roles: ["admin"] })],
    // ...
  });
  ```

- Access request/reply and user
  ```ts
  const { request, reply, user } = fastifyContext.use();
  ```

- Throw HTTP errors
  ```ts
  throw new HTTPError(404, "Not found");
  ```

- Merge params/query/body as input
  ```ts
  tags: [httpRoute.with({ method: "get", path: "/items/:id", inputFrom: "merged" })]
  ```

- Explore tasks/events in Runner Dev
  - Visit http://localhost:1337/docs and http://localhost:1337/graphql

- Update OpenAPI docs
  - Ensure your tasks have `inputSchema`/`resultSchema`. Fastify route schemas are derived automatically and shown at `/swagger`.
