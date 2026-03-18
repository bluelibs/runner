## Your First 5 Minutes

This page is the shortest path from "what is Runner?" to "I ran it once and I trust the shape of it."

**New to Runner?** Here's the absolute minimum you need to know:

1. **Tasks** are your business logic functions with dependencies, middleware, and validation.
2. **Resources** are shared services with a four-phase lifecycle: `init`, `ready`, `cooldown`, `dispose`.
3. **You compose everything** under an `app` resource with `.register([...])`.
4. **You run it** with `run(app)` which gives you `runTask()` and `dispose()` first, then more runtime helpers as you grow.

---

## Quick Start

This is the fastest way to run the TypeScript example at the top of this README.

1. Confirm prerequisites from [Prerequisites](#prerequisites) (Node `22+`, TypeScript `5.6+` recommended).
2. Install dependencies:

```bash
npm i @bluelibs/runner
npm i -D typescript tsx
```

3. Copy the example above into `index.ts`.
4. Run it:

```bash
npx tsx index.ts
```

**What you now have**: a working `runtime`, explicit dependency wiring, and the smallest useful Runner execution path.

> **Tip:** User-defined ids are local ids. Use `createUser` or `userStore`, not dotted ids like `app.tasks.createUser`.
> **Platform Note:** Advanced features such as Durable Workflows and server-side Remote Lanes are Node-only.

### Local Ids vs Canonical Runtime Ids

You write local ids in definitions:

- `task("createUser")`
- `resource("userStore")`
- `event("userCreated")`

Runner composes canonical runtime ids from ownership:

- `app.tasks.createUser`
- `app.userStore`
- `app.events.userCreated`

Prefer references such as `runTask(createUser, input)` over string ids whenever you can.

---

## Runner Dev Tools Quick Start

`@bluelibs/runner-dev` gives you CLI scaffolding and runtime introspection.

1. Install (or run without install):

```bash
npm install -g @bluelibs/runner-dev
# or
npx @bluelibs/runner-dev --help
```

2. Three common commands:

```bash
# Scaffold a new Runner project
runner-dev new my-app --install

# Query tasks from a local TypeScript entry file (dry-run mode)
runner-dev query 'query { tasks { id } }' --entry-file ./src/main.ts

# Inspect a running app via GraphQL endpoint
ENDPOINT=http://localhost:1337/graphql runner-dev overview --details 10
```

For full CLI and Dev UI docs, see [Runner Dev Tools](https://github.com/bluelibs/runner-dev).

---

## Real-World Examples

- [AWS Lambda Quickstart](./examples/aws-lambda-quickstart/README.md)
- [Express + OpenAPI + SQLite](./examples/express-openapi-sqlite/README.md)
- [Fastify + MikroORM + PostgreSQL](./examples/fastify-mikroorm/README.md)

---

## Where To Go Next

- **Complete guide**: Read [FULL_GUIDE.md](./readmes/FULL_GUIDE.md).
- **Popular guide sections**:
  - [Tasks](https://github.com/bluelibs/runner/blob/main/readmes/FULL_GUIDE.md#tasks)
  - [Resources](https://github.com/bluelibs/runner/blob/main/readmes/FULL_GUIDE.md#resources)
  - [Middleware](https://github.com/bluelibs/runner/blob/main/readmes/FULL_GUIDE.md#middleware)
  - [Testing](https://github.com/bluelibs/runner/blob/main/readmes/FULL_GUIDE.md#testing)
  - [Observability](https://github.com/bluelibs/runner/blob/main/readmes/FULL_GUIDE.md#observability-strategy-logs-metrics-and-traces)
- **API reference**: Browse the [TypeDoc documentation](https://bluelibs.github.io/runner/).
- **Token-friendly overview**: Read [COMPACT_GUIDE.md](./readmes/COMPACT_GUIDE.md).
- **Node-only features**:
  - [Durable Workflows](./readmes/DURABLE_WORKFLOWS.md)
  - [Remote Lanes](./readmes/REMOTE_LANES.md)
- **Releases and upgrades**:
  - [GitHub Releases](https://github.com/bluelibs/runner/releases)
  - [Support & Release Policy](./readmes/ENTERPRISE.md)
- **Multi-platform architecture**: Read [MULTI_PLATFORM.md](./readmes/MULTI_PLATFORM.md).

---

## License

This project is licensed under the MIT License. See [LICENSE.md](./LICENSE.md).
