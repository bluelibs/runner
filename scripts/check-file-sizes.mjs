#!/usr/bin/env node
/**
 * check-file-sizes.mjs
 *
 * Counts *code* lines (non-empty, comments stripped) for source files under src/.
 *
 * Comment stripping uses a regex-based approach that removes only line comments
 * and block comments — NOT TypeScript type annotations. This gives an accurate
 * LOC count for all file types, including interface-only files.
 *
 * Modes:
 *   --mode=large  (default)  list files *over*  the threshold, sorted desc
 *   --mode=small             list files *under* the threshold, sorted asc
 *
 * Threshold: --threshold=N | env THRESHOLD | defaults to 200
 *
 * Supported extensions: .ts .tsx .js .jsx .mjs
 * All files including tests are scanned. node_modules inside src/ are excluded.
 */

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// CLI / config resolution
// ---------------------------------------------------------------------------

const ROOT_DIR = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
// On Windows the URL pathname starts with a leading slash: /C:/Users/...
const SRC_DIR = path.join(ROOT_DIR.replace(/^\/([A-Za-z]:)/, "$1"), "src");

function parseArgs() {
  const args = process.argv.slice(2);

  const modeArg = args.find((a) => a.startsWith("--mode="));
  const mode = modeArg ? modeArg.split("=")[1] : "large";
  if (mode !== "large" && mode !== "small") {
    console.error(`Invalid --mode: "${mode}". Use "large" or "small".`);
    process.exit(2);
  }

  // Threshold can come from --threshold=N, positional arg (legacy), or THRESHOLD env
  const thresholdArg =
    args.find((a) => a.startsWith("--threshold="))?.split("=")[1] ??
    args.find((a) => /^-?\d+$/.test(a)) ??
    process.env.THRESHOLD;

  const raw = thresholdArg ?? "200";
  if (!/^-?\d+$/.test(raw)) {
    console.error(`Invalid threshold: "${raw}" (must be an integer).`);
    process.exit(2);
  }
  // Always work with the absolute value; sign is meaningless here since mode
  // determines the comparison direction.
  const threshold = Math.abs(Number(raw));

  return { mode, threshold };
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

/** Recursively collect all matching source files under a directory. */
function collectFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // Skip nested dependency folders if present under src.
    if (entry.isDirectory() && entry.name === "node_modules") continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full));
    } else if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Comment stripping (regex-based)
// ---------------------------------------------------------------------------

/**
 * Strip line comments (//) and block comments (slash-star...star-slash) from
 * source while preserving all code including TypeScript type annotations.
 * Regex-based — no subprocess, no AST — fast enough for a dev-tool script and
 * more accurate than esbuild for type-heavy files (esbuild erases type annotations,
 * making interface-only files report 0 lines).
 *
 * Handles:
 *   - Block comments (including JSDoc)
 *   - Single-line comments
 *   - Preserves string literals and template literals to avoid false positives
 */
function stripComments(source) {
  // This regex matches (in order of priority):
  //   1. Block comments  /* … */
  //   2. Single-line comments //…
  //   3. String literals "…" and '…' (to skip // inside strings)
  //   4. Template literals `…` (to skip // inside templates)
  // Replacing group 1/2 with empty string and groups 3/4 with themselves (no-op)
  // keeps string content intact while removing comments.
  return source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g,
    (match, stringLiteral) => (stringLiteral !== undefined ? stringLiteral : ""),
  );
}

// ---------------------------------------------------------------------------
// Counting helpers
// ---------------------------------------------------------------------------

/** Count non-empty (non-whitespace-only) lines in a string. */
function countNonEmptyLines(text) {
  return text.split("\n").filter((l) => l.trim().length > 0).length;
}

/** Rough GPT-style token estimate: ~4 chars per token. */
function estimateTokens(chars) {
  return Math.ceil(chars / 4);
}

// ---------------------------------------------------------------------------
// Analysis — synchronous since comment stripping is now pure regex
// ---------------------------------------------------------------------------

function analyzeFiles(files) {
  return files.map((filePath) => {
    const source = fs.readFileSync(filePath, "utf8");
    const stripped = stripComments(source);

    const lines = countNonEmptyLines(stripped);
    const chars = Buffer.byteLength(source, "utf8");
    const tokens = estimateTokens(chars);

    return { filePath, lines, chars, tokens };
  });
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function printTable(entries, rootDir) {
  const header = [
    "code-lines".padEnd(16),
    "chars".padEnd(12),
    "tokens-est".padEnd(12),
    "path",
  ].join(" ");

  const separator = "-".repeat(header.length);

  console.log(`${BOLD}${header}${RESET}`);
  console.log(separator);

  for (const { filePath, lines, chars, tokens } of entries) {
    // Print path relative to project root for readability.
    const rel = path.relative(rootDir, filePath).replaceAll("\\", "/");
    console.log(
      [
        String(lines).padEnd(16),
        String(chars).padEnd(12),
        String(tokens).padEnd(12),
        rel,
      ].join(" ")
    );
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const { mode, threshold } = parseArgs();

  if (!fs.existsSync(SRC_DIR)) {
    console.error(`src directory not found: ${SRC_DIR}`);
    process.exit(1);
  }

  const files = collectFiles(SRC_DIR);
  const analyzed = analyzeFiles(files);

  // Filter by mode, then sort.
  const filtered =
    mode === "large"
      ? analyzed
          .filter((f) => f.lines > threshold)
          .sort((a, b) => b.lines - a.lines)
      : analyzed
          .filter((f) => f.lines < threshold)
          .sort((a, b) => a.lines - b.lines);

  if (filtered.length === 0) {
    const direction = mode === "large" ? "over" : "under";
    console.log(
      `No files ${direction} ${threshold} code lines found under ${SRC_DIR}.`
    );
    return;
  }

  printTable(filtered, ROOT_DIR.replace(/^\/([A-Za-z]:)/, "$1"));
}

main();
