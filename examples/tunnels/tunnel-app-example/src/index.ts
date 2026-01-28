import { runTunnelAppExample } from "./example.js";

async function main(): Promise<void> {
  await runTunnelAppExample();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
