# AGENTS.md

Authoritative guidance for working inside this repository as an agent. This app uses BlueLibs Runner, Fastify, and MikroORM (PostgreSQL). Read `README.md` and `readmes/runner-AI.md` for broader context. If `readmes/runner-AI.md` is missing, sync docs with `npx ts-node scripts/sync-docs.ts`.

## Repo Orientation

- HTTP: `src/http`
  - Router: `resources/fastify-router.resource.ts` (wires tasks with `httpRoute` to Fastify)
  - Tag: `tags/http-route.tag.ts`
  - Error class: `http-error.ts`
  - Context: `fastify-context.ts`
- Users module: `src/users` (auth resource, tasks, tests, registration)
- DB: `src/db` (MikroORM config, entities in `src/db/entities`, migrations in `src/db/migrations`)
- App entry: `src/main.ts` (registers `env`, `db`, `fixtures`, `http`, `users`, `runner-dev`)
- Test utils: `src/general/test/utils.ts` (`buildTestRunner`, `testOrmConfig`)
- Import alias: use `#/` to refer to `src/` (see README “Import Aliases”).

## Golden Rules (Must Follow)

- Use `httpRoute` tags to map HTTP endpoints to tasks with correct `method` and `path`.
- Implement predictable HTTP errors by throwing `HTTPError` from tasks; the router maps these to responses.
- Always set `meta.title` and `meta.description` for tasks/resources.
- Always define `inputSchema` and `resultSchema` for tasks using `zod`.
- Prefer strict typing; avoid `any` and `unknown`.
- Prefer optional chaining and direct access (for example `cfg?.that?.x`) over manual guards.
- Define MikroORM entities under `src/db/entities`.
- After entity changes: `npm run db:migrate:create` then `npm run db:migrate:up`.
- Each new task must have a close-by test; split large tests into multiple files if needed.
- Ensure anything you add is registered (feature `index.ts` and/or app/root resource).

## HTTP + Tasks Pattern

- Tag tasks with `httpRoute` to expose them via Fastify. Config lives in `src/http/tags/http-route.tag.ts`:
  - `method`: `get|post|put|delete|patch|options|head`
  - `path`: string
  - `inputFrom`: `"body" | "merged"` (merged uses `{...params, ...query, ...body}`)
  - `auth`: `"public" | "optional" | "required"`
- Fastify router (`src/http/resources/fastify-router.resource.ts`) auto-registers routes for all tasks tagged with `httpRoute`, builds schemas from `inputSchema`/`resultSchema`, sets `x-request-id`, attaches a child logger, enforces `auth` mode, and maps errors.
- Always add:
  - `meta`: meaningful `title` and `description`
  - `inputSchema` and `resultSchema` (`zod`) – these power runtime validation and Swagger
  - `tags: [httpRoute.with({ ... })]`
  - optional `middleware` (for example `authorize.with({ roles: ["admin"] })`)
- Throw `new HTTPError(status, message, details?)` for expected errors; the router handles `ValidationError` as 400 and defaults to 500 for unknown errors.

Example (abbreviated):

```ts
export const getUserById = task({
  id: "app.users.tasks.getUserById",
  meta: { title: "Get user", description: "Fetch user by id" },
  inputSchema: z.object({ id: z.string() }).strict(),
  resultSchema: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
  }),
  tags: [
    httpRoute.with({
      method: "get",
      path: "/users/:id",
      inputFrom: "merged",
      auth: "optional",
    }),
  ],
  run: async ({ id }, { em }) => {
    const user = await em.findOne(User, { id });
    if (!user) throw new HTTPError(404, "User not found");
    return { id: user.id, name: user.name, email: user.email };
  },
});
```

## Registration

- Register new tasks/resources/middlewares in their feature `index.ts` (example: `src/users/index.ts` registers tasks, `auth` resource, and `authorize` middleware). Unregistered items won’t be discoverable by the router or other dependencies.
- The HTTP layer is registered in `src/http/index.ts` and the app root in `src/main.ts`. Ensure your feature resource is included in the app if you add a new feature.
- In tests, explicitly register what you need using `buildTestRunner({ register: [...] })` and include `httpRoute` + `fastify` + `fastifyRouter` when testing HTTP behavior.

## Authorization & Auth

- Use `authorize` task middleware (`src/http/middleware/authorize.middleware.ts`) to protect tasks by role:
  - `required` (default `true`): user must exist; otherwise 401
  - `roles`: allowed roles; otherwise 403
- At the route level, set `httpRoute.with({ auth: "public|optional|required" })`:
  - `required` returns 401 before invoking the task when no user is present
  - `optional` attaches user if present
  - `public` does not require a user
- The router extracts user and request context into `fastifyContext` (`request`, `reply`, `user`, `userId`, `logger`, `requestId`). Use via `const { user, request, reply } = fastifyContext.use();`.

## Database & Migrations

- Place entity classes in `src/db/entities`. Update related repositories/resources as needed.
- Migrations workflow:
  - Emit: `npm run db:migrate:create`
  - Apply: `npm run db:migrate:up`
  - Down: `npm run db:migrate:down`
- Fixtures run via `src/db/resources/fixtures.resource.ts` the first time against an empty DB.
- Tests use in-memory SQLite overrides (`testOrmConfig`) so they are fast and hermetic.

## Testing Guidance

- Keep tests close to what they validate (same folder or nearby). If a test grows large, split it.
- Use `buildTestRunner` from `src/general/test/utils.ts`:

```ts
const rr = await buildTestRunner({
  register: [httpRoute, fastify, fastifyRouter, db, users],
  overrides: [testOrmConfig],
});

const res = await rr.http.inject({ method: "GET", url: "/users" });
expect(res.statusCode).toBe(200);
```

- When testing task logic without HTTP, register only the task’s dependencies and run tasks directly with the runner’s `taskRunner` or by invoking the task function.
- Ensure your tests cover: validation (bad inputs → 400), auth paths (401/403), happy paths (200), and error mapping (`HTTPError`).

## TypeScript & Style

- Prefer exact, strict types; avoid `any`/`unknown`.
- Use `zod` schemas consistently; derive types from schemas when useful.
- Prefer optional chaining and nullish coalescing: `cfg?.x ?? default`.
- Keep naming explicit and descriptive; always fill `meta.title`/`meta.description`.
- Use the `#/` alias for imports from `src` to keep paths short and clear.

## Dev & Tooling

- Runner Dev portal runs on `http://localhost:1337` with GraphQL, Voyager, and docs.
- Fastify HTTP server runs on `http://localhost:3000`; Swagger is at `/swagger`.
- Sync local AI docs (optional): `npx ts-node scripts/sync-docs.ts` updates `readmes/`.

## Common Recipes

Create a new HTTP endpoint:

1. Create a task under `src/<feature>/tasks/*.task.ts`.
2. Add `meta`, `inputSchema`, `resultSchema`.
3. Tag it with `httpRoute.with({ method, path, auth, inputFrom? })`.
4. Register the task in the feature `index.ts`.
5. Add a close-by test that registers `httpRoute`, `fastify`, and `fastifyRouter` if testing HTTP.

Throw predictable HTTP errors from tasks:

```ts
import { HTTPError } from "#/http/http-error";
throw new HTTPError(404, "Not found");
```
