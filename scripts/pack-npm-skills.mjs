#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");
const mode = process.argv[2];

const syncPairs = [
  {
    sourcePath: path.join(projectRoot, "guide-units"),
    destinationPath: path.join(
      projectRoot,
      "skills",
      "core",
      "references",
      "guide-units",
    ),
    symlinkTarget: "../../../guide-units",
  },
  {
    sourcePath: path.join(projectRoot, "readmes"),
    destinationPath: path.join(
      projectRoot,
      "skills",
      "core",
      "references",
      "readmes",
    ),
    symlinkTarget: "../../../readmes",
  },
];

if (mode !== "materialize" && mode !== "restore") {
  console.error(
    "[npm-skills] Expected mode to be either 'materialize' or 'restore'.",
  );
  process.exit(1);
}

async function materializeDirectory({ sourcePath, destinationPath }) {
  await fs.rm(destinationPath, { force: true, recursive: true });
  await fs.cp(sourcePath, destinationPath, { recursive: true });

  console.log(
    `[npm-skills] Materialized ${path.relative(projectRoot, destinationPath)}.`,
  );
}

async function restoreSymlink({ destinationPath, symlinkTarget }) {
  await fs.rm(destinationPath, { force: true, recursive: true });
  await fs.symlink(symlinkTarget, destinationPath, "dir");

  console.log(
    `[npm-skills] Restored symlink ${path.relative(projectRoot, destinationPath)} -> ${symlinkTarget}.`,
  );
}

try {
  for (const syncPair of syncPairs) {
    if (mode === "materialize") {
      await materializeDirectory(syncPair);
    } else {
      await restoreSymlink(syncPair);
    }
  }
} catch (error) {
  console.error(`[npm-skills] ${error.message}`);
  process.exit(1);
}
