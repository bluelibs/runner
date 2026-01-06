#!/usr/bin/env node

/**
 * Compose README.md from individual chapter files
 * Usage: node compose-readme.mjs
 *
 * This script reads guide-units/CORE.md which lists all chapters
 * in order, then concatenates them to create the final README.md
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_PATH = path.join(__dirname, "..", "guide-units", "CORE.md");
const README_PATH = path.join(__dirname, "..", "README.md");
const CHAPTERS_DIR = path.join(__dirname, "..", "guide-units");

/**
 * Parse CORE.md to extract chapter references
 * Expected format: lines like "!include: 00-HEADER.md"
 */
function parseCore() {
  const content = fs.readFileSync(CORE_PATH, "utf-8");
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
    console.warn(`⚠️  Warning: Chapter file not found: ${filename}`);
    return "";
  }
  return fs.readFileSync(filepath, "utf-8");
}

/**
 * Compose the final README
 */
function compose() {
  try {
    console.log("📖 Parsing CORE.md...");
    const chapters = parseCore();

    if (chapters.length === 0) {
      console.error("❌ No chapters found in CORE.md");
      process.exit(1);
    }

    console.log(`📚 Found ${chapters.length} chapters`);

    let readme = "";
    for (const chapter of chapters) {
      console.log(`   📄 Loading ${chapter}...`);
      const content = loadChapter(chapter);
      readme += content;

      // Add newline between chapters if the chapter doesn't end with one
      if (!readme.endsWith("\n")) {
        readme += "\n";
      }
    }

    // Write the final README
    fs.writeFileSync(README_PATH, readme, "utf-8");

    const lineCount = readme.split("\n").length;
    console.log(`\n✅ Successfully composed README.md (${lineCount} lines)`);
  } catch (error) {
    console.error("❌ Error composing README:", error.message);
    process.exit(1);
  }
}

compose();
