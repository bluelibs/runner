/**
 * Middleware Example
 *
 * Demonstrates:
 * - Creating task middleware
 * - Applying middleware to specific tasks
 * - Global middleware with .everywhere()
 * - Middleware execution order
 * - Context passing through middleware chain
 */

import { r, run } from "@bluelibs/runner";

// Logger resource for middleware
const logger = r
  .resource("logger")
  .init(async () => ({
    info: (msg: string) => console.log(`ℹ️  ${msg}`),
    error: (msg: string) => console.error(`❌ ${msg}`),
  }))
  .build();

// Middleware 1: Logging
const loggingMiddleware = r.middleware
  .task("loggingMiddleware")
  .dependencies({ logger })
  .run(async ({ task, next }, { logger }) => {
    const start = Date.now();
    logger.info(`→ Starting ${task.definition.id}`);

    try {
      const result = await next(task.input);
      const duration = Date.now() - start;
      logger.info(`← Completed ${task.definition.id} (${duration}ms)`);
      return result;
    } catch (error) {
      logger.error(`✗ Failed ${task.definition.id}: ${error.message}`);
      throw error;
    }
  })
  .build();

// Middleware 2: Timing
const timingMiddleware = r.middleware
  .task("timingMiddleware")
  .run(async ({ task, next }) => {
    const start = performance.now();
    const result = await next(task.input);
    const duration = performance.now() - start;
    console.log(`⏱️  ${task.definition.id}: ${duration.toFixed(2)}ms`);
    return result;
  })
  .build();

// Middleware 3: Validation (applied globally with filter)
const validationMiddleware = r.middleware
  .task("validationMiddleware")
  .everywhere((task) => task.id.startsWith("api."))
  .run(async ({ task, next }) => {
    console.log(`🔍 Validating input for ${task.definition.id}`);
    // Validate input here
    if (!task.input) {
      throw new Error("Input is required");
    }
    return await next(task.input);
  })
  .build();

// Task with multiple middleware (executes in order)
const processData = r
  .task("api.processData")
  .inputSchema<{ data: string }>({ parse: (v) => v })
  .middleware([loggingMiddleware, timingMiddleware])
  .run(async (input) => {
    console.log(`  💼 Processing: ${input.data}`);
    // Simulate work
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { processed: input.data.toUpperCase() };
  })
  .build();

// Task without explicit middleware (but gets global validationMiddleware)
const calculateSum = r
  .task("api.calculateSum")
  .inputSchema<{ numbers: number[] }>({ parse: (v) => v })
  .run(async (input) => {
    console.log(`  🧮 Calculating sum of ${input.numbers.length} numbers`);
    return input.numbers.reduce((a, b) => a + b, 0);
  })
  .build();

// Non-API task (won't get validationMiddleware)
const internalTask = r
  .task("internal.task")
  .run(async () => {
    console.log(`  🔧 Internal task executing`);
    return "done";
  })
  .build();

// App
const app = r
  .resource("app")
  .register([
    logger,
    loggingMiddleware,
    timingMiddleware,
    validationMiddleware,
    processData,
    calculateSum,
    internalTask,
  ])
  .build();

async function main() {
  const { runTask, dispose } = await run(app);

  console.log("1. Task with explicit middleware:");
  await runTask(processData, { data: "hello" });

  console.log("\n2. API task with global validation middleware:");
  await runTask(calculateSum, { numbers: [1, 2, 3, 4, 5] });

  console.log("\n3. Internal task (no validation middleware):");
  await runTask(internalTask);

  await dispose();
}

if (require.main === module) {
  main().catch(console.error);
}

export {
  loggingMiddleware,
  timingMiddleware,
  validationMiddleware,
  processData,
  app,
};
