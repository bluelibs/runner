#!/usr/bin/env node
import { spawn } from "child_process";

function parseArgs(argv) {
  const idx = argv.indexOf("--");
  if (idx === -1) return { jestArgs: argv.slice(2) };
  return { jestArgs: argv.slice(idx + 1) };
}

function toNumber(value) {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const { jestArgs } = parseArgs(process.argv);
  const watchdogMs = toNumber(process.env.JEST_WATCHDOG_MS) ?? 10 * 60 * 1000; // 10 minutes

  const child = spawn("jest", jestArgs, {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });

  const timer = setTimeout(() => {
    console.error(
      `Jest watchdog: killing process after ${watchdogMs}ms (set JEST_WATCHDOG_MS to override).`,
    );
    child.kill("SIGKILL");
  }, watchdogMs);

  child.on("close", (code) => {
    clearTimeout(timer);
    process.exit(code ?? 1);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
