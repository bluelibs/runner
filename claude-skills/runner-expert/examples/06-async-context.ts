/**
 * Async Context Example
 *
 * Demonstrates:
 * - Creating async context for request-scoped data
 * - Providing context in a scope
 * - Using context in tasks
 * - Context flowing through the call stack
 * - Injecting context as a dependency
 */

import { r, run } from "@bluelibs/runner";

// Define request context
const requestContext = r
  .asyncContext<{ requestId: string; userId: string }>("request")
  .build();

// Task that uses context directly
const getRequestInfo = r
  .task("getRequestInfo")
  .dependencies({ requestContext })
  .run(async (_input, { requestContext }) => {
    const ctx = requestContext.use();
    return {
      message: `Processing request ${ctx.requestId} for user ${ctx.userId}`,
      requestId: ctx.requestId,
      userId: ctx.userId,
    };
  })
  .build();

// Task that calls another task (context flows through)
const processRequest = r
  .task("processRequest")
  .inputSchema<{ action: string }>({ parse: (v) => v })
  .dependencies({ requestContext, getRequestInfo })
  .run(async (input, { requestContext, getRequestInfo }) => {
    const ctx = requestContext.use();
    console.log(`🔄 Processing ${input.action} for request ${ctx.requestId}`);

    // Get request info (context flows through the call)
    const info = await getRequestInfo();

    return {
      action: input.action,
      ...info,
      timestamp: new Date().toISOString(),
    };
  })
  .build();

// Task that requires context (will fail if context not provided)
const authenticatedTask = r
  .task("authenticatedTask")
  .middleware([requestContext.require()]) // Ensures context is available
  .dependencies({ requestContext })
  .run(async (_input, { requestContext }) => {
    const ctx = requestContext.use();
    return `Authenticated task for user ${ctx.userId}`;
  })
  .build();

// App
const app = r
  .resource("app")
  .register([requestContext, getRequestInfo, processRequest, authenticatedTask])
  .build();

async function main() {
  const { runTask, dispose } = await run(app);

  console.log("1. Running task WITH context provided:");
  await requestContext.provide(
    { requestId: "req-123", userId: "user-456" },
    async () => {
      const result = await runTask(processRequest, { action: "create_order" });
      console.log("Result:", result);
    }
  );

  console.log("\n2. Running authenticated task WITH context:");
  await requestContext.provide(
    { requestId: "req-789", userId: "user-999" },
    async () => {
      const result = await runTask(authenticatedTask);
      console.log("Result:", result);
    }
  );

  console.log("\n3. Attempting to run task WITHOUT context (will fail):");
  try {
    await runTask(authenticatedTask);
  } catch (error) {
    console.log("Expected error:", error.message);
  }

  console.log("\n4. Multiple concurrent requests with different contexts:");
  await Promise.all([
    requestContext.provide(
      { requestId: "req-A", userId: "user-A" },
      async () => {
        console.log("\n  Request A:");
        const result = await runTask(processRequest, { action: "action_A" });
        console.log("  Result A:", result.requestId);
      }
    ),
    requestContext.provide(
      { requestId: "req-B", userId: "user-B" },
      async () => {
        console.log("\n  Request B:");
        const result = await runTask(processRequest, { action: "action_B" });
        console.log("  Result B:", result.requestId);
      }
    ),
  ]);

  await dispose();
}

if (require.main === module) {
  main().catch(console.error);
}

export { requestContext, getRequestInfo, processRequest, authenticatedTask, app };
