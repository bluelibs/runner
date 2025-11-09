/**
 * Basic Task Example
 *
 * Demonstrates:
 * - Creating a simple task with fluent builder API
 * - Input/output typing
 * - Running a task
 * - Proper cleanup with dispose()
 */

import { r, run } from "@bluelibs/runner";

// Create a simple task that greets a user
const greet = r
  .task("greet")
  .inputSchema<{ name: string }>({ parse: (v) => v })
  .resultSchema<string>({ parse: (v) => v })
  .run(async (input) => {
    return `Hello, ${input.name}!`;
  })
  .build();

// Register and run the task
const app = r.resource("app").register([greet]).build();

async function main() {
  const { runTask, dispose } = await run(app);

  // Execute the task
  const result = await runTask(greet, { name: "World" });
  console.log(result); // "Hello, World!"

  // Always dispose to clean up resources
  await dispose();
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { greet, app };
