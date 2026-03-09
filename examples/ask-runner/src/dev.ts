import path from "path";
import { spawn, type ChildProcess } from "child_process";

import chokidar from "chokidar";

const watchPaths = [
  path.resolve(process.cwd(), "src/**/*.ts"),
  path.resolve(process.cwd(), "package.json"),
  path.resolve(process.cwd(), "tsconfig.json"),
];

const entryFile = path.resolve(process.cwd(), "src/index.ts");
const tsxCliPath = require.resolve("tsx/cli");

let childProcess: ChildProcess | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let stopping = false;

function startChild(): void {
  childProcess = spawn(process.execPath, [tsxCliPath, entryFile], {
    cwd: process.cwd(),
    stdio: "inherit",
  });

  childProcess.once("exit", () => {
    childProcess = null;

    if (!stopping) {
      scheduleRestart();
    }
  });
}

function stopChild(onStopped?: () => void): void {
  if (!childProcess) {
    onStopped?.();
    return;
  }

  const processToStop = childProcess;
  childProcess = null;
  processToStop.once("exit", () => {
    onStopped?.();
  });
  processToStop.kill("SIGTERM");
}

function scheduleRestart(): void {
  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    stopChild(() => {
      if (!stopping) {
        startChild();
      }
    });
  }, 100);
}

function shutdown(): void {
  stopping = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  watcher.close().catch(() => undefined);
  stopChild(() => {
    process.exit(0);
  });
}

const watcher = chokidar.watch(watchPaths, {
  awaitWriteFinish: {
    pollInterval: 100,
    stabilityThreshold: 150,
  },
  ignoreInitial: true,
  usePolling: true,
  interval: 150,
});

watcher.on("all", () => {
  scheduleRestart();
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

startChild();
