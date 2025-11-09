/**
 * Dependency Injection Patterns
 *
 * Demonstrates:
 * - Basic DI with dependencies()
 * - Optional dependencies
 * - Dynamic dependencies based on configuration
 * - Global resources
 */

import { r, run, globals } from "@bluelibs/runner";

// Basic dependency injection
const logger = r
  .resource("logger")
  .init(async () => ({
    info: (msg: string) => console.log(`ℹ️  ${msg}`),
    error: (msg: string) => console.error(`❌ ${msg}`),
  }))
  .build();

const basicTask = r
  .task("basicTask")
  .dependencies({ logger })
  .run(async (input: string, { logger }) => {
    logger.info(`Processing: ${input}`);
    return `Processed: ${input}`;
  })
  .build();

// Optional dependencies
const analytics = r
  .resource("analytics")
  .init(async () => ({
    track: (event: string) => console.log(`📊 Tracked: ${event}`),
  }))
  .build();

const optionalTask = r
  .task("optionalTask")
  .dependencies({ analytics: analytics.optional() })
  .run(async (input: string, { analytics }) => {
    // Analytics might be null if not registered
    if (analytics) {
      analytics.track("task_executed");
    }
    return input;
  })
  .build();

// Dynamic dependencies based on configuration
const cacheService = r
  .resource("cache")
  .init(async () => ({
    get: async (key: string) => null,
    set: async (key: string, value: any) => {},
  }))
  .build();

const directService = r
  .resource("direct")
  .init(async () => ({
    fetch: async (id: string) => ({ id, data: "direct" }),
  }))
  .build();

const dynamicTask = r
  .task("dynamicTask")
  .configSchema<{ useCache: boolean }>({ parse: (v) => v })
  .dependencies((config) => ({
    // Choose dependency based on config
    service: config.useCache ? cacheService : directService,
  }))
  .run(async (id: string, { service }, config) => {
    console.log(`Using ${config.useCache ? "cache" : "direct"} service`);
    return await service.fetch(id);
  })
  .build();

// Using global resources
const globalTask = r
  .task("globalTask")
  .dependencies({ logger: globals.resources.logger })
  .run(async (input: string, { logger }) => {
    logger.info(`Using global logger: ${input}`);
    return input;
  })
  .build();

// App with all examples
const app = r
  .resource("app")
  .register([
    logger,
    analytics,
    basicTask,
    optionalTask,
    cacheService,
    directService,
    dynamicTask.with({ useCache: true }),
    globalTask,
  ])
  .build();

async function main() {
  const { runTask, dispose } = await run(app);

  console.log("\n1. Basic DI:");
  await runTask(basicTask, "test data");

  console.log("\n2. Optional DI (with analytics):");
  await runTask(optionalTask, "optional test");

  console.log("\n3. Dynamic DI (with cache):");
  await runTask(dynamicTask, "item-123");

  console.log("\n4. Global resources:");
  await runTask(globalTask, "global test");

  await dispose();
}

if (require.main === module) {
  main().catch(console.error);
}

export { logger, basicTask, optionalTask, dynamicTask, globalTask, app };
