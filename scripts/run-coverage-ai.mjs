#!/usr/bin/env node
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import {
  isInCoverageScope,
  toCoverageScopedRelPosixPath,
} from "./coverage-scope.mjs";

function parseArgs(argv) {
  const idx = argv.indexOf("--");
  if (idx === -1) return { extraJestArgs: [] };
  return { extraJestArgs: argv.slice(idx + 1) };
}

function readJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch (_) {
    return undefined;
  }
}

function computeCounts(map) {
  const entries = map && typeof map === "object" ? Object.values(map) : [];
  let total = 0;
  let hit = 0;
  for (const v of entries) {
    total++;
    if (Number(v) > 0) hit++;
  }
  return { hit, total };
}

function computeBranchCounts(branchHits) {
  const entries =
    branchHits && typeof branchHits === "object"
      ? Object.values(branchHits)
      : [];
  let total = 0;
  let hit = 0;
  for (const arr of entries) {
    const a = Array.isArray(arr) ? arr : [];
    total += a.length;
    hit += a.filter((x) => Number(x) > 0).length;
  }
  return { hit, total };
}

function countCoverageBelowHundredFromFinal() {
  const finalPath = path.join(process.cwd(), "coverage", "coverage-final.json");
  const final = readJson(finalPath);
  if (!final || typeof final !== "object") return undefined;

  let count = 0;
  for (const [absFile, entry] of Object.entries(final)) {
    if (!absFile || !entry) continue;
    const relPosix = toCoverageScopedRelPosixPath(absFile);
    if (!isInCoverageScope(relPosix)) continue;

    const stmtCounts = computeCounts(entry.s);
    const lineCounts = computeCounts(entry.l);
    const funcCounts = computeCounts(entry.f);
    const branchCounts = computeBranchCounts(entry.b);

    const allHundred =
      stmtCounts.hit === stmtCounts.total &&
      lineCounts.hit === lineCounts.total &&
      funcCounts.hit === funcCounts.total &&
      branchCounts.hit === branchCounts.total;
    if (!allHundred) count++;
  }
  return count;
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

  const coverageDir = path.join(process.cwd(), "coverage");
  fs.mkdirSync(coverageDir, { recursive: true });
  const reporterSummaryPath = path.join(coverageDir, "ai-jest-summary.json");

  const jestArgs = [
    "--config",
    "config/jest/jest.config.js",
    "--coverage",
    "--reporters=./scripts/jest-ai-reporter.js",
    "--coverageReporters=json-summary",
    "--coverageReporters=json",
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
      AI_REPORTER_SUMMARY_PATH: reporterSummaryPath,
    },
  );

  const coverageCode = await run("node", [
    "./scripts/print-fresh-coverage.mjs",
  ]);

  const reporterSummary = readJson(reporterSummaryPath);
  const failedTests =
    typeof reporterSummary?.summary?.failedTests === "number"
      ? reporterSummary.summary.failedTests
      : undefined;
  const runtimeErrorSuites =
    typeof reporterSummary?.summary?.runtimeErrorSuites === "number"
      ? reporterSummary.summary.runtimeErrorSuites
      : undefined;
  const errors =
    typeof failedTests === "number" && typeof runtimeErrorSuites === "number"
      ? failedTests + runtimeErrorSuites
      : undefined;
  const coverageBelowHundredFiles = countCoverageBelowHundredFromFinal();

  const end = performance.now();
  const duration = ((end - start) / 1000).toFixed(2);
  console.log(
    `\nDone in ${duration}s | Errors: ${errors ?? "?"} | Coverage<100%: ${
      coverageBelowHundredFiles ?? "?"
    }`,
  );

  process.exit(jestCode !== 0 ? jestCode : coverageCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
