#!/usr/bin/env node

/**
 * Compose documentation outputs from guide-units.
 * Usage: node compose-guide.mjs
 *
 * Outputs:
 * - README.md: landing page (short) - at repository root
 * - readmes/FULL_GUIDE.md: full guide (composed from chapters) - inside readmes/
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INDEX_GUIDE_PATH = path.join(
  __dirname,
  "..",
  "guide-units",
  "INDEX_GUIDE.md",
);
const INDEX_README_PATH = path.join(
  __dirname,
  "..",
  "guide-units",
  "INDEX_README.md",
);

const README_PATH = path.join(__dirname, "..", "README.md");
const GUIDE_PATH = path.join(__dirname, "..", "readmes", "FULL_GUIDE.md");
const CHAPTERS_DIR = path.join(__dirname, "..", "guide-units");

/**
 * Parse a core file to extract chapter references
 * Expected format: lines like "!include: 00-header.md"
 */
function parseCore(corePath) {
  if (!fs.existsSync(corePath)) {
    throw new Error(`Missing core file: ${corePath}`);
  }

  const content = fs.readFileSync(corePath, "utf-8");
  const lines = content.split("\n");
  const chapters = [];

  for (const line of lines) {
    const match = line.match(/^!include:\s*(.+?\.md)\s*$/);
    if (match) {
      chapters.push(match[1].trim());
    }
  }

  return chapters;
}

/**
 * Load a chapter file
 */
function loadChapter(filename) {
  const filepath = path.join(CHAPTERS_DIR, filename);
  if (!fs.existsSync(filepath)) {
    throw new Error(`Missing chapter file: ${filename}`);
  }
  return fs.readFileSync(filepath, "utf-8");
}

/**
 * Adjust relative paths for files inside readmes/ directory.
 * Converts paths like ./readmes/X.md to ./X.md when the output is inside readmes/
 */
function adjustPathsForReadmesDir(content) {
  // Adjust markdown links: [text](./readmes/FILE.md) -> [text](./FILE.md)
  content = content.replace(/\]\(\.\/readmes\/([^)]+)\)/g, "](./$1)");

  // Adjust paths to root-level files: [text](./FILE.md) -> [text](../FILE.md)
  // But only for specific known root files (README.md, LICENSE.md)
  content = content.replace(/\]\(\.\/README\.md\)/g, "](../README.md)");
  content = content.replace(/\]\(\.\/LICENSE\.md\)/g, "](../LICENSE.md)");

  // Adjust .github paths: [text](./.github/X) -> [text](../.github/X)
  content = content.replace(/\]\(\.\/.github\//g, "](../.github/");

  // Adjust examples paths: [text](./examples/X) -> [text](../examples/X)
  content = content.replace(/\]\(\.\/examples\//g, "](../examples/");

  return content;
}

/**
 * Compose an output file from a core include list.
 */
function composeOutput({ corePath, outputPath, label, adjustPaths }) {
  console.log(`[compose] Parsing ${path.basename(corePath)} (${label})...`);
  const chapters = parseCore(corePath);

  if (chapters.length === 0) {
    throw new Error(`No chapters found in ${corePath}`);
  }

  console.log(`[compose] Found ${chapters.length} chapters for ${label}`);

  let output = "";
  for (const chapter of chapters) {
    console.log(`[compose] Loading ${chapter}...`);
    const content = loadChapter(chapter);
    output += content;

    if (!output.endsWith("\n")) {
      output += "\n";
    }
  }

  // Apply path adjustments if needed (for files inside readmes/)
  if (adjustPaths) {
    console.log(`[compose] Adjusting relative paths for ${label}...`);
    output = adjustPathsForReadmesDir(output);
  }

  fs.writeFileSync(outputPath, output, "utf-8");

  const lineCount = output.split("\n").length;
  console.log(
    `[compose] Wrote ${path.basename(outputPath)} (${lineCount} lines)`,
  );
}

function composeAll() {
  composeOutput({
    corePath: INDEX_README_PATH,
    outputPath: README_PATH,
    label: "landing README",
    adjustPaths: false,
  });

  composeOutput({
    corePath: INDEX_GUIDE_PATH,
    outputPath: GUIDE_PATH,
    label: "full guide",
    adjustPaths: true,
  });
}

try {
  composeAll();
} catch (error) {
  console.error(`[compose] Failed: ${error.message}`);
  process.exit(1);
}

