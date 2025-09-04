import { run } from "@bluelibs/runner";
import { app } from "./app/app.resource";

/**
 * Start the application
 */
async function startApp() {
  try {
    const { value: appInstance, dispose } = await run(app, {
      debug: "normal",
      logs: {
        printThreshold: "info",
      },
    });
    return appInstance;
  } catch (error) {
    process.exit(0);
  }
}

// Start the app if this file is run directly
// This is to allow the tests to run the app without having to run the startApp function.
if (require.main === module) {
  startApp();
}

export { app, startApp };
