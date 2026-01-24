#!/usr/bin/env node
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PACKAGE_ROOT = path.join(__dirname, "..");
const DASHBOARD_DIR = path.join(
  PACKAGE_ROOT,
  "src",
  "node",
  "durable",
  "dashboard",
);

function printHelp() {
  console.log(
    [
      "Builds the durable dashboard UI into dist/ui.",
      "",
      "Usage:",
      "  node scripts/build-dashboard.mjs [--install] [--help]",
      "",
      "Options:",
      "  --install   If dashboard deps are missing, install them first.",
      "  --help      Print this help.",
      "",
    ].join("\n"),
  );
}

function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function run(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    });
    child.on("close", (code) => resolve(code ?? 0));
  });
}

function assertDashboardDependenciesInstalled() {
  const nodeModules = path.join(DASHBOARD_DIR, "node_modules");
  if (fs.existsSync(nodeModules)) return;

  const dashboardRelative = path.relative(PACKAGE_ROOT, DASHBOARD_DIR);
  console.error("Durable dashboard dependencies are not installed.");
  console.error(`Run: cd ${dashboardRelative} && npm install`);
  process.exit(1);
}

async function ensureDashboardDependenciesInstalled() {
  const nodeModules = path.join(DASHBOARD_DIR, "node_modules");
  if (fs.existsSync(nodeModules)) return;

  const npm = getNpmCommand();
  const hasLockfile = fs.existsSync(path.join(DASHBOARD_DIR, "package-lock.json"));
  const installArgs = hasLockfile ? ["ci"] : ["install"];

  const exitCode = await run(npm, installArgs, { cwd: DASHBOARD_DIR });
  if (exitCode !== 0) process.exit(exitCode);

  if (!fs.existsSync(nodeModules)) {
    console.error("Dashboard dependency installation finished but node_modules is still missing.");
    process.exit(1);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    printHelp();
    return;
  }

  if (!fs.existsSync(path.join(DASHBOARD_DIR, "package.json"))) {
    console.error(`Dashboard package.json not found at: ${DASHBOARD_DIR}`);
    process.exit(1);
  }

  if (args.has("--install")) {
    await ensureDashboardDependenciesInstalled();
  } else {
    assertDashboardDependenciesInstalled();
  }

  const npm = getNpmCommand();
  const exitCode = await run(npm, ["run", "build"], { cwd: DASHBOARD_DIR });
  if (exitCode !== 0) process.exit(exitCode);

  const uiDist = path.join(PACKAGE_ROOT, "dist", "ui");
  const indexHtml = path.join(uiDist, "index.html");
  if (!fs.existsSync(indexHtml)) {
    console.error(`Dashboard build finished but ${indexHtml} was not found.`);
    process.exit(1);
  }

  console.log(`Dashboard UI built to ${path.relative(PACKAGE_ROOT, uiDist)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

