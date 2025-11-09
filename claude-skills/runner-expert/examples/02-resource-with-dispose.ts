/**
 * Resource with Lifecycle Example
 *
 * Demonstrates:
 * - Creating a resource (singleton)
 * - Resource initialization
 * - Resource disposal/cleanup
 * - Using resources in tasks
 */

import { r, run } from "@bluelibs/runner";

// Resource: Database connection (simulated)
const database = r
  .resource("db")
  .init(async () => {
    console.log("📡 Connecting to database...");
    // Simulate database connection
    return {
      connected: true,
      query: async (sql: string) => {
        console.log(`  Executing: ${sql}`);
        return [{ id: 1, name: "Alice" }];
      },
      close: async () => {
        console.log("🔌 Closing database connection");
      },
    };
  })
  .dispose(async (db) => {
    // Called automatically on app shutdown
    await db.close();
  })
  .build();

// Task that uses the database resource
const getUsers = r
  .task("getUsers")
  .dependencies({ db: database })
  .run(async (_input, { db }) => {
    const users = await db.query("SELECT * FROM users");
    return users;
  })
  .build();

// App that registers everything
const app = r
  .resource("app")
  .register([database, getUsers])
  .build();

async function main() {
  const { runTask, dispose } = await run(app);

  // Use the task
  const users = await runTask(getUsers);
  console.log("Users:", users);

  // Dispose will call database.dispose() automatically
  await dispose();
}

if (require.main === module) {
  main().catch(console.error);
}

export { database, getUsers, app };
