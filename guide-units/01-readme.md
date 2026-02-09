## Your First 5 Minutes

**New to Runner?** Here's the absolute minimum you need to know:

1. **Tasks** are your business logic functions (with dependencies and middleware)
2. **Resources** are shared services (database, config, clients) with lifecycle (`init` / `dispose`)
3. **You compose everything** under an `app` resource with `.register([...])`
4. **You run it** with `run(app)` which gives you `runTask()` and `dispose()`

That's it. Now let's get you to a first successful run.

---

## Quick Start

This is the fastest way to run the TypeScript example at the top of this README:

0. Confirm prerequisites from [Prerequisites](#prerequisites) (Node `18+`, TypeScript `5.6+` recommended)

1. Install dependencies:

```bash
npm i @bluelibs/runner zod
npm i -D typescript tsx
```

2. Copy the example into `index.ts`
3. Run it:

```bash
npx tsx index.ts
```

**That's it!** You now have a working `Runtime` and you can execute tasks with `runtime.runTask(...)`.

> **Tip:** If you prefer an end-to-end example with HTTP, OpenAPI, and persistence, jump to the examples below.

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

- [Express + OpenAPI + SQLite](./examples/express-openapi-sqlite/README.md)
- [Fastify + MikroORM + PostgreSQL](./examples/fastify-mikroorm/README.md)

---

## Where To Go Next

- **Complete guide**: Read [FULL_GUIDE.md](./readmes/FULL_GUIDE.md) (the full reference, composed from `guide-units/`)
- **Popular guide sections**:
  - [Tasks](https://github.com/bluelibs/runner/blob/main/readmes/FULL_GUIDE.md#tasks)
  - [Resources](https://github.com/bluelibs/runner/blob/main/readmes/FULL_GUIDE.md#resources)
  - [Middleware](https://github.com/bluelibs/runner/blob/main/readmes/FULL_GUIDE.md#middleware)
  - [Testing](https://github.com/bluelibs/runner/blob/main/readmes/FULL_GUIDE.md#testing)
  - [Troubleshooting](https://github.com/bluelibs/runner/blob/main/readmes/FULL_GUIDE.md#troubleshooting)
- **API reference**: Browse the [TypeDoc documentation](https://bluelibs.github.io/runner/)
- **Token-friendly overview**: Read [AI.md](./readmes/AI.md)
- **Node-only features**:
  - [Durable Workflows](./readmes/DURABLE_WORKFLOWS.md)
  - [HTTP Tunnels](./readmes/TUNNELS.md)
- **Releases and upgrades**:
  - [GitHub Releases](https://github.com/bluelibs/runner/releases)
  - [Support & Release Policy](./readmes/ENTERPRISE.md)
- **Operational baseline**:
  - [Production Readiness Checklist](./readmes/FULL_GUIDE.md#production-readiness-checklist)
- **Multi-platform architecture**: Read [MULTI_PLATFORM.md](./readmes/MULTI_PLATFORM.md)

---

## License

This project is licensed under the MIT License - see [LICENSE.md](./LICENSE.md).
