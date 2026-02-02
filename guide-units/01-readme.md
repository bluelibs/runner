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

**That’s it!** You now have a working `Runtime` and you can execute tasks with `runtime.runTask(...)`.

> **Tip:** If you prefer an end-to-end example with HTTP, OpenAPI, and persistence, jump to the examples below.

---

## Real-World Examples

- [Express + OpenAPI + SQLite](./examples/express-openapi-sqlite/README.md)
- [Fastify + MikroORM + PostgreSQL](./examples/fastify-mikroorm/README.md)

---

## Where To Go Next

- **Complete guide**: Read [FULL_GUIDE.md](./readmes/FULL_GUIDE.md) (the full reference, composed from `guide-units/`)
- **Popular guide sections**:
  - [Tasks](./readmes/FULL_GUIDE.md#tasks)
  - [Resources](./readmes/FULL_GUIDE.md#resources)
  - [Middleware](./readmes/FULL_GUIDE.md#middleware)
  - [Testing](./readmes/FULL_GUIDE.md#testing)
  - [Troubleshooting](./readmes/FULL_GUIDE.md#troubleshooting)
- **API reference**: Browse the [TypeDoc documentation](https://bluelibs.github.io/runner/)
- **Token-friendly overview**: Read [AI.md](./readmes/AI.md)
- **Node-only features**:
  - [Durable Workflows](./readmes/DURABLE_WORKFLOWS.md)
  - [HTTP Tunnels](./readmes/TUNNELS.md)
- **Multi-platform architecture**: Read [MULTI_PLATFORM.md](./readmes/MULTI_PLATFORM.md)

---

## License

This project is licensed under the MIT License - see [LICENSE.md](./LICENSE.md).
