import { run } from "@bluelibs/runner";
import { app } from "./modules";

/**
 * Start the application
 */
async function startApp() {
  try {
    const { value: appInstance, dispose } = await run(app);

    // Graceful shutdown
    process.on("SIGTERM", async () => {
      console.log("\n📴 Received SIGTERM, shutting down gracefully...");
      await dispose();
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      console.log("\n📴 Received SIGINT, shutting down gracefully...");
      await dispose();
      process.exit(0);
    });

    return appInstance;
  } catch (error) {
    console.error("❌ Failed to start application:", error);
    process.exit(1);
  }
}

// Start the app if this file is run directly
if (require.main === module) {
  startApp();
}

export { app, startApp };
