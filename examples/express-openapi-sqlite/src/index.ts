import { run } from "@bluelibs/runner";
import { app } from "./modules";

/**
 * Start the application
 */
async function startApp() {
  try {
    const { value: appInstance, dispose } = await run(app, {
      debug: "normal",
    });
    return appInstance;
  } catch (error) {
    process.exit(0);
  }
}

// Start the app if this file is run directly
if (require.main === module) {
  startApp();
}

export { app, startApp };
