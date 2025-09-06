# clearspec-attempt

Minimal app built with @bluelibs/runner, Fastify and MikroORM (PostgreSQL). It includes a dev portal (Runner Dev) and a tiny Users feature with a GET /users route, plus simple authentication (register/login, cookie or Bearer).

## What runs where

- Runner Dev portal: http://localhost:1337
  - GraphQL: http://localhost:1337/graphql (introspection, tasks/events, live telemetry)
  - Voyager: http://localhost:1337/voyager
  - Docs: http://localhost:1337/docs
- App HTTP server (Fastify): http://localhost:3000
  - Example route: GET /users
  - Auth routes: POST /auth/register, POST /auth/login, POST /auth/logout, GET /me
- MikroORM (PostgreSQL)

## Prerequisites

- Node.js 20+
- PostgreSQL

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
npx mikro-orm migration:up
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

## Database

- ORM: MikroORM (PostgreSQL)
- Config: `src/db/resources/orm.config.ts`
- Migrations: `src/db/migrations` (TypeScript), emitted to `dist/db/migrations`
- Apply migrations: `npx mikro-orm migration:up`

Schema (via migrations) includes `users` and `posts` tables with a relation (`posts.author_id -> users.id`).
Users also have `password_hash` and `password_salt` columns.

## Features in this repo

- HTTP wiring: `src/http` – Fastify instance and router that binds tasks tagged with `httpRoute` to routes
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
  - Example: `tags: [httpRoute.with({ method: "post", path: "/auth/login" })]`
- The Fastify router (`src/http/resources/fastify-router.resource.ts`) does two things:
  - Passes `request.body` directly as the task input.
  - Provides a `FastifyContext` so tasks can access `request` and `reply` when needed.
- Global error handling is set in `src/http/resources/fastify.resource.ts`:
  - Throw `new HTTPError(status, message)` from tasks to return proper HTTP codes.
  - Zod/Runner validation errors are returned as `400`.

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

## Troubleshooting

- DB connection errors: ensure PostgreSQL is running on `localhost:5433` and the database `clearspec` exists, or update the URL in `src/db/resources/orm.config.ts`.
- Port conflicts: Runner Dev uses 1337, Fastify uses 3000 (see `src/http/hooks/onReady.hook.ts`).
