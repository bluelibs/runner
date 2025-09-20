// Runs the JWT auth tunnel example using the local Runner source.
// Keep imports relative to the repo per project conventions.

import { runJwtAuthExample } from "./example.js";

async function main(): Promise<void> {
  await runJwtAuthExample();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
