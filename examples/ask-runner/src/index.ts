import { run } from "@bluelibs/runner";

import { app } from "./app/app.resource";

async function startApp() {
  const runtime = await run(app, {
    logs: { printThreshold: "info" },
  });
  return runtime;
}

if (require.main === module) {
  void startApp();
}

export { startApp };
