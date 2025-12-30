#!/usr/bin/env node
import { spawn } from "child_process";
import path from "path";

function parseArgs(argv) {
  const idx = argv.indexOf("--");
  if (idx === -1) return { extraJestArgs: [] };
  return { extraJestArgs: argv.slice(idx + 1) };
}

function run(cmd, args, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      env: { ...process.env, ...env },
      shell: false,
    });
    child.on("close", (code) => resolve(code ?? 0));
  });
}

async function main() {
  const start = performance.now();
  const { extraJestArgs } = parseArgs(process.argv);

  const jestArgs = [
    "--coverage",
    "--reporters=./scripts/jest-ai-reporter.js",
    "--coverageReporters=json-summary",
    "--silent",
  ];

  if (process.env.AI_COVERAGE_FULL_REPORTS === "1") {
    jestArgs.push("--coverageReporters=lcov", "--coverageReporters=html");
  }
  jestArgs.push(...extraJestArgs);
  const jestCode = await run(
    "node",
    ["./scripts/run-jest-watchdog.mjs", "--", ...jestArgs],
    {
      AI_REPORTER_DISABLE_COVERAGE: "1",
    },
  );
  const nodeCode = await run("node", [
    path.join("./scripts/print-fresh-coverage.mjs"),
  ]);

  const end = performance.now();
  const duration = ((end - start) / 1000).toFixed(2);
  console.log(`\n✨ Done in ${duration}s`);

  process.exit(jestCode !== 0 ? jestCode : nodeCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
