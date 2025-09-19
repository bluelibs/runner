#!/usr/bin/env node
import { spawn } from "child_process";
import path from "path";

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
  const jestArgs = [
    "--coverage",
    "--reporters=./scripts/jest-ai-reporter.js",
    "--coverageReporters=json-summary",
    "--coverageReporters=lcov",
    "--coverageReporters=html",
    "--silent",
  ];
  const jestCode = await run("jest", jestArgs, {
    AI_REPORTER_DISABLE_COVERAGE: "1",
  });
  const nodeCode = await run("node", [
    path.join("./scripts/print-fresh-coverage.mjs"),
  ]);
  process.exit(jestCode !== 0 ? jestCode : nodeCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
