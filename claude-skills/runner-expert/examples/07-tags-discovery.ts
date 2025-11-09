/**
 * Tags and Discovery Example
 *
 * Demonstrates:
 * - Creating typed tags
 * - Tagging tasks with metadata
 * - Runtime discovery of tagged tasks
 * - Using tags for auto-registration (e.g., HTTP routes)
 * - Tag-based filtering and configuration
 */

import { r, run, globals } from "@bluelibs/runner";

// Define a tag for HTTP routes
const httpRoute = r
  .tag("httpRoute")
  .configSchema<{ method: "GET" | "POST" | "PUT" | "DELETE"; path: string }>({
    parse: (v) => v,
  })
  .build();

// Define a tag for caching
const cacheable = r
  .tag("cacheable")
  .configSchema<{ ttl: number }>({ parse: (v) => v })
  .build();

// Task 1: Health check endpoint
const getHealth = r
  .task("getHealth")
  .tags([
    httpRoute.with({ method: "GET", path: "/health" }),
    cacheable.with({ ttl: 30000 }), // Cache for 30s
  ])
  .run(async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }))
  .build();

// Task 2: Get user endpoint
const getUser = r
  .task("getUser")
  .tags([httpRoute.with({ method: "GET", path: "/users/:id" })])
  .inputSchema<{ id: string }>({ parse: (v) => v })
  .run(async (input) => ({
    id: input.id,
    name: "John Doe",
    email: "john@example.com",
  }))
  .build();

// Task 3: Create user endpoint
const createUser = r
  .task("createUser")
  .tags([httpRoute.with({ method: "POST", path: "/users" })])
  .inputSchema<{ name: string; email: string }>({ parse: (v) => v })
  .run(async (input) => ({
    id: `user-${Date.now()}`,
    name: input.name,
    email: input.email,
  }))
  .build();

// Task 4: Internal task (no HTTP route)
const internalTask = r
  .task("internalTask")
  .run(async () => "Internal only")
  .build();

// Server resource that discovers and registers routes
const server = r
  .resource("server")
  .dependencies({ store: globals.resources.store })
  .init(async (_, { store }) => {
    console.log("\n🔍 Discovering HTTP routes...\n");

    // Get all tasks tagged with httpRoute
    const routes = store.getTasksWithTag(httpRoute);

    console.log(`Found ${routes.length} HTTP routes:\n`);

    routes.forEach(({ definition, config }) => {
      const cacheConfig = definition.tags?.find((t) =>
        store.hasTag(definition, cacheable)
      );
      const cacheInfo = cacheConfig ? ` [Cached: ${cacheConfig.ttl}ms]` : "";

      console.log(`  ${config.method.padEnd(6)} ${config.path}${cacheInfo}`);
      console.log(`         → Task: ${definition.id}`);
    });

    // In a real app, you'd register these with Express/Fastify
    // app.get(config.path, async (req, res) => {
    //   const result = await store.runTask(definition, req.params);
    //   res.json(result);
    // });

    console.log("\n✅ Routes registered\n");

    return { routes };
  })
  .build();

// App
const app = r
  .resource("app")
  .register([
    httpRoute,
    cacheable,
    getHealth,
    getUser,
    createUser,
    internalTask,
    server,
  ])
  .build();

async function main() {
  const { getResourceValue, runTask, dispose } = await run(app);

  // Get the server to see discovered routes
  const serverValue = await getResourceValue(server);

  console.log("\nTesting discovered routes:");

  // Test the health endpoint
  console.log("\n1. GET /health:");
  const health = await runTask(getHealth);
  console.log("  Response:", health);

  // Test the get user endpoint
  console.log("\n2. GET /users/:id:");
  const user = await runTask(getUser, { id: "123" });
  console.log("  Response:", user);

  // Test the create user endpoint
  console.log("\n3. POST /users:");
  const newUser = await runTask(createUser, {
    name: "Alice",
    email: "alice@example.com",
  });
  console.log("  Response:", newUser);

  console.log("\n4. Internal task (no HTTP route):");
  const internal = await runTask(internalTask);
  console.log("  Response:", internal);

  await dispose();
}

if (require.main === module) {
  main().catch(console.error);
}

export { httpRoute, cacheable, getHealth, getUser, createUser, server, app };
