/**
 * Universal Example
 * Code that works identically across Node.js, browsers, and edge runtimes
 */
import { run, resource, task, event, hook } from "@bluelibs/runner";

// Universal logger that adapts to environment
const logger = resource({
  id: "universal-logger",
  init: async () => {
    const isNode = typeof process !== "undefined" && process.versions?.node;
    const isBrowser = typeof window !== "undefined";
    const isEdge = !isNode && !isBrowser;

    return {
      info: (message, data) => {
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}]`;

        if (isNode) {
          console.log(`${prefix} [NODE] ${message}`, data || "");
        } else if (isBrowser) {
          console.log(`${prefix} [BROWSER] ${message}`, data || "");
        } else {
          console.log(`${prefix} [EDGE] ${message}`, data || "");
        }
      },
      error: (message, error) => {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] ERROR: ${message}`, error);
      },
    };
  },
});

// Universal data processor
const dataProcessor = task({
  id: "process-data",
  dependencies: { logger },
  run: async (input, { logger }) => {
    logger.info("Processing data", { inputType: typeof input });

    // Simulate some processing
    await new Promise((resolve) => setTimeout(resolve, 10));

    const result = {
      processed: true,
      originalInput: input,
      timestamp: new Date().toISOString(),
      environment: {
        isNode: typeof process !== "undefined" && process.versions?.node,
        isBrowser: typeof window !== "undefined",
        isEdge: typeof process === "undefined" && typeof window === "undefined",
      },
    };

    logger.info("Data processing complete", result);
    return result;
  },
});

// Universal event
const dataProcessed = event({
  id: "data-processed",
});

// Universal event handler
const onDataProcessed = hook({
  id: "on-data-processed",
  on: dataProcessed,
  dependencies: { logger },
  run: async (event, { logger }) => {
    logger.info("Data processed event received", event.data);
  },
});

// Universal app
const universalApp = resource({
  id: "universal-app",
  register: [logger, dataProcessor, onDataProcessed],
  dependencies: { logger, processor: dataProcessor },
  init: async (_, { logger, processor }) => {
    logger.info("Universal app starting...");

    // Test data processing
    const testResult = await processor("Hello Universal World!");

    logger.info("Universal app ready", { testResult });

    return {
      processor,
      process: async (data) => {
        const result = await processor(data);
        // Emit event (would work with event system in full runner)
        return result;
      },
    };
  },
  dispose: async (instance, config, deps, { logger }) => {
    logger.info("Universal app shutting down gracefully");
  },
});

// Universal runner function
export async function startUniversalApp(customData = null) {
  try {
    const result = await run(universalApp, {
      // These options work everywhere, with platform-specific adaptations
      shutdownHooks: true,
      errorBoundary: true,
      logs: {
        printThreshold: "info",
        printStrategy: "pretty",
      },
    });

    if (customData) {
      const processed = await result.value.process(customData);
      console.log("Custom data processed:", processed);
    }

    return result;
  } catch (error) {
    console.error("Failed to start universal app:", error);
    throw error;
  }
}

// Export for different environments
export { universalApp, dataProcessor, logger };

// Auto-start if this is the main module
if (
  typeof process !== "undefined" &&
  process.argv?.[1]?.endsWith("universal-example.js")
) {
  // Node.js direct execution
  startUniversalApp("Node.js CLI execution").then(() => {
    console.log("Universal app demo completed successfully!");
  });
} else if (typeof window !== "undefined" && window.location) {
  // Browser environment - attach to window for demo
  window.startUniversalApp = startUniversalApp;
  console.log("Universal app available at window.startUniversalApp()");
}

// This file demonstrates that the exact same code can:
// 1. Run as a Node.js CLI application
// 2. Be imported in a browser via ES modules
// 3. Work in edge runtimes like Cloudflare Workers
// 4. Provide the same API and behavior everywhere
