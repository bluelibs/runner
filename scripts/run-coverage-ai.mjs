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
  if (idx === -1) return { extraJestArgs: argv.slice(2) };
  return { extraJestArgs: argv.slice(idx + 1) };
}

function hasMaxWorkersArg(args) {
  return args.some(
    (arg) => arg === "--maxWorkers" || arg.startsWith("--maxWorkers="),
  );
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

function run(cmd, args, env, { filterStderr = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: filterStderr ? ["inherit", "inherit", "pipe"] : "inherit",
      env: { ...process.env, ...env },
      shell: false,
    });
    if (filterStderr && child.stderr) {
      // V8 prints multi-line "Exception in PromiseRejectCallback" blocks to
      // stderr when deeply nested async rejection propagation overflows the
      // stack (e.g. during cycle detection tests with coverage instrumentation).
      // These are harmless — Jest catches the errors — but they pollute output.
      // We suppress entire blocks: once a trigger line is seen, drop lines
      // until a blank line follows the "RangeError" trailer.
      let stderrBuf = "";
      let suppressing = false;
      let blankAfterRangeError = false;
      child.stderr.setEncoding("utf-8");
      child.stderr.on("data", (chunk) => {
        stderrBuf += chunk;
        const lines = stderrBuf.split("\n");
        stderrBuf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.includes("Exception in PromiseRejectCallback")) {
            suppressing = true;
            blankAfterRangeError = false;
            continue;
          }
          if (suppressing) {
            if (line.includes("RangeError: Maximum call stack size exceeded")) {
              blankAfterRangeError = true;
              continue;
            }
            if (blankAfterRangeError && line.trim() === "") {
              suppressing = false;
              blankAfterRangeError = false;
              continue;
            }
            // Still inside the V8 block (source snippet lines)
            continue;
          }
          process.stderr.write(line + "\n");
        }
      });
      child.stderr.on("end", () => {
        if (stderrBuf && !suppressing) {
          process.stderr.write(stderrBuf + "\n");
        }
      });
    }
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

  if (!hasMaxWorkersArg(extraJestArgs)) {
    jestArgs.push("--maxWorkers=50%");
  }

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
      NODE_NO_WARNINGS: "1",
    },
    { filterStderr: true },
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
