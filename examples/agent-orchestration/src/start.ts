import { runDemoFromEnv } from "./index.js";

void runDemoFromEnv().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
