## Your First 5 Minutes

**New to Runner?** Here's the absolute minimum you need to know:

1. **Tasks** are your business logic functions
2. **Resources** are shared services (database, config, etc.)
3. **You compose them** using `r.resource()` and `r.task()`
4. **You run them** with `run(app)` which gives you `runTask()` and `dispose()`

That's it! Now let's see it in action:

---

## Quick Start

Let's start with the simplest possible example. Just copy this, run it, and you'll see Runner in action:

```bash
npm install @bluelibs/runner
```

```typescript
import { r, run } from "@bluelibs/runner";

// Step 1: Create a simple task (just a function with a name)
const greet = r
  .task("greet")
  .run(async (name: string) => `Hello, ${name}! 👋`)
  .build();

// Step 2: Put it in a resource (think of it as your app container)
const app = r
  .resource("app")
  .register([greet]) // Tell the app about your task
  .build();

// Step 3: Run it!
const { runTask, dispose } = await run(app);

// Step 4: Use your task
const message = await runTask(greet, "World");
console.log(message); // "Hello, World! 👋"

// Step 5: Clean up when done
await dispose();
```

That's it! You just:

1. ✅ Created a task
2. ✅ Registered it
3. ✅ Ran it
4. ✅ Cleaned up

**What you just learned**: The basic Runner pattern: Define → Register → Run → Execute. Everything else builds on this foundation.

**Next step**: See how this scales to real apps below.

### Building a Real Express Server

Now that you've seen the basics, let's build something real! Here's a complete Express API server with dependency injection, logging, and proper lifecycle management. (And yes, it's less code than most frameworks need for "Hello World" 😊)

```bash
npm install @bluelibs/runner express
```

```typescript
import express from "express";
import { r, run, globals } from "@bluelibs/runner";

// A resource is anything you want to share across your app, a singleton
const server = r
  .resource<{ port: number }>("app.server")
  .init(async ({ port }, dependencies) => {
    const app = express();
    app.use(express.json());
    const listener = await app.listen(port);
    console.log(`Server running on port ${port}`);

    return { listener };
  })
  .dispose(async ({ listener }) => listener.close())
  .build();

// Tasks are your business logic - easily testable functions
const createUser = r
  .task("app.tasks.createUser")
  .dependencies({ server, logger: globals.resources.logger })
  .inputSchema<{ name: string }>({ parse: (value) => value })
  .run(async (input, { server, logger }) => {
    await logger.info(`Creating ${input.name}`);
    return { id: "user-123", name: input.name };
  })
  .build();

// Wire everything together
const app = r
  .resource("app")
  .register([server.with({ port: 3000 }), createUser])
  .dependencies({ server, createUser })
  .init(async (_config, { server, createUser }) => {
    server.listener.on("listening", () => {
      console.log("Runner HTTP server ready");
    });

    server.app.post("/users", async (req, res) => {
      const user = await createUser(req.body);
      res.json(user);
    });
  })
  .build();

// That's it! Each run is fully isolated
const runtime = await run(app);
const { dispose, runTask, getResourceValue, emitEvent } = runtime;

// Want to see what's happening? Add debug logging:
await run(app, { debug: "verbose" });
```

**🎉 What you just built:**

- ✅ A full Express API with proper lifecycle management
- ✅ Dependency injection (tasks get what they need automatically)
- ✅ Built-in logging (via `globals.resources.logger`)
- ✅ Graceful shutdown (the `dispose()` method)
- ✅ Type-safe everything (TypeScript has your back)

**Note**: See how we used `r.task()` and `r.resource()`? That's the **fluent builder API** – the recommended way to build with Runner. It's chainable, type-safe, and reads like a story.

### Classic API (still supported)

Prefer fluent builders for new code, but the classic `define`-style API remains supported and can be mixed in the same app:

```ts
import { resource, task, run } from "@bluelibs/runner";

const db = resource({ id: "app.db", init: async () => "conn" });
const add = task({
  id: "app.tasks.add",
  run: async (i: { a: number; b: number }) => i.a + i.b,
});

const app = resource({ id: "app", register: [db, add] });
await run(app);
```

See [complete docs](../readmes/FLUENT_BUILDERS.md) for migration tips and side‑by‑side patterns.

### Platform & Async Context

Runner auto-detects the platform and adapts behavior at runtime. The only feature present only in Node.js is the use of `AsyncLocalStorage` for managing async context.

---
