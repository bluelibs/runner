/**
 * AI-friendly Jest Reporter
 * Prints only:
 * - Failing tests with concise path and message
 * - Coverage summary for files that are not at 100% for statements/branches/functions/lines
 *
 * Usage:
 *   jest --coverage --reporters=default --reporters=./scripts/jest-ai-reporter.js
 */

/* eslint-disable no-console */

const path = require("path");
const fs = require("fs");

function round(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function pctStr(value) {
  return `${round(value)}%`;
}

function isFailure(results) {
  return results.numFailedTests > 0 || results.numRuntimeErrorTestSuites > 0;
}

function parseFirstStackLocation(message) {
  const text = String(message);
  const cwd = process.cwd();
  const patterns = [/\(([^\n()]+):(\d+):(\d+)\)/g, /\s([^\s()]+):(\d+):(\d+)/g];
  for (const re of patterns) {
    let match;
    while ((match = re.exec(text))) {
      const [, filePath, line, column] = match;
      if (!filePath) continue;
      const normalized = path.normalize(filePath);
      // Prefer paths from current project
      if (normalized.includes(cwd)) {
        return {
          file: path.relative(cwd, normalized),
          line: Number(line),
          column: Number(column),
        };
      }
    }
  }
  return undefined;
}

function formatLineRanges(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return "";
  const sorted = Array.from(
    new Set(
      lines.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0),
    ),
  ).sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  const ranges = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i];
    if (curr === prev + 1) {
      prev = curr;
    } else {
      ranges.push(start === prev ? String(start) : `${start}-${prev}`);
      start = prev = curr;
    }
  }
  ranges.push(start === prev ? String(start) : `${start}-${prev}`);
  return ranges.join(", ");
}

function getMissedLinesOnlyFromFileCoverage(fileCoverage) {
  const missed = new Set();
  try {
    if (!fileCoverage) return [];
    // Lines with 0 hits (line coverage) – this is the authoritative source
    if (typeof fileCoverage.getLineCoverage === "function") {
      const lineMap = fileCoverage.getLineCoverage();
      for (const [lineStr, hits] of Object.entries(lineMap)) {
        const line = Number(lineStr);
        if (Number.isFinite(line) && hits === 0) missed.add(line);
      }
    }
  } catch (_) {
    // ignore and fallback to LCOV parsing when needed
  }
  return Array.from(missed);
}

function readSourceLines(filePath) {
  try {
    if (!filePath) return undefined;
    if (!fs.existsSync(filePath)) return undefined;
    const content = fs.readFileSync(filePath, "utf-8");
    return content.split(/\r?\n/);
  } catch (_) {
    return undefined;
  }
}

function extractCodeFromLoc(lines, loc) {
  try {
    if (!lines || !loc || !loc.start || !loc.end) return undefined;
    const sLine = Math.max(1, Number(loc.start.line));
    const eLine = Math.max(1, Number(loc.end.line));
    const sCol = Math.max(0, Number(loc.start.column || 0));
    const eCol = Math.max(0, Number(loc.end.column || 0));
    const startIdx = sLine - 1;
    const endIdx = eLine - 1;
    if (!Number.isFinite(startIdx) || !Number.isFinite(endIdx))
      return undefined;
    if (!lines[startIdx]) return undefined;
    if (startIdx === endIdx) {
      const lineText = lines[startIdx] || "";
      return lineText.slice(sCol, eCol || lineText.length).trim();
    }
    const parts = [];
    const firstLine = lines[startIdx] || "";
    parts.push(firstLine.slice(sCol));
    for (let i = startIdx + 1; i < endIdx; i++) {
      parts.push(lines[i] || "");
    }
    const lastLine = lines[endIdx] || "";
    parts.push(lastLine.slice(0, eCol || lastLine.length));
    return parts.join("\n").trim();
  } catch (_) {
    return undefined;
  }
}

function getUncoveredBranchesFromFileCoverage(fileCoverage) {
  const result = [];
  try {
    if (!fileCoverage) return result;
    const data = fileCoverage.data || fileCoverage;
    if (!data || !data.branchMap || !data.b) return result;
    const filePath = fileCoverage.path || undefined;
    const sourceLines = readSourceLines(filePath);
    for (const [bid, counts] of Object.entries(data.b)) {
      const mapEntry = data.branchMap[bid];
      const arr = Array.isArray(counts) ? counts : [];
      for (let i = 0; i < arr.length; i++) {
        const taken = Number(arr[i]);
        if (taken === 0) {
          const loc =
            (mapEntry && mapEntry.locations && mapEntry.locations[i]) ||
            (mapEntry && mapEntry.loc) ||
            undefined;
          const line = loc && loc.start && Number(loc.start.line);
          if (Number.isFinite(line)) {
            const code =
              extractCodeFromLoc(sourceLines, loc) ||
              (sourceLines && sourceLines[line - 1]
                ? sourceLines[line - 1].trim()
                : undefined);
            result.push({ line: Number(line), code });
          }
        }
      }
    }
  } catch (_) {
    // ignore
  }
  // Merge duplicates by line, keep first code snippet
  const byLine = new Map();
  for (const item of result) {
    if (!byLine.has(item.line)) byLine.set(item.line, item);
  }
  return Array.from(byLine.values()).sort((a, b) => a.line - b.line);
}

function readMissedFromLcovDetailed(lcovPath) {
  const result = new Map();
  try {
    if (!fs.existsSync(lcovPath)) return result;
    const content = fs.readFileSync(lcovPath, "utf-8");
    const cwd = process.cwd();
    let currentFile;
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.startsWith("SF:")) {
        const filePath = path.normalize(line.slice(3));
        // Prefer project-relative paths
        const rel = filePath.includes(cwd)
          ? path.relative(cwd, filePath)
          : filePath;
        currentFile = rel;
        if (!result.has(currentFile))
          result.set(currentFile, { lines: new Set(), branches: new Set() });
      } else if (line.startsWith("DA:") && currentFile) {
        const rest = line.slice(3);
        const [lineNoStr, hitsStr] = rest.split(",");
        const lineNo = Number(lineNoStr);
        const hits = Number(hitsStr);
        if (Number.isFinite(lineNo) && hits === 0) {
          result.get(currentFile).lines.add(lineNo);
        }
      } else if (line.startsWith("BRDA:") && currentFile) {
        // BRDA:<line>,<block>,<branch>,<taken>
        const rest = line.slice(5);
        const [lineNoStr, _block, _branch, takenStr] = rest.split(",");
        const lineNo = Number(lineNoStr);
        // Per LCOV spec, taken can be '-' or a number; 0 means not taken (missed)
        if (Number.isFinite(lineNo) && takenStr === "0") {
          result.get(currentFile).branches.add(lineNo);
        }
      } else if (line === "end_of_record") {
        currentFile = undefined;
      }
    }
  } catch (_) {
    // ignore errors
  }
  // Convert Set to array
  for (const [k, v] of result.entries()) {
    result.set(k, {
      lines: Array.from(v.lines),
      branches: Array.from(v.branches),
    });
  }
  return result;
}

function formatFailure(testResult) {
  const items = [];
  const relative = path.relative(process.cwd(), testResult.testFilePath);
  for (const assertion of testResult.testResults) {
    if (assertion.status === "failed") {
      let locFile = relative;
      let locLine;
      let locColumn;
      if (assertion.location && typeof assertion.location.line === "number") {
        locLine = assertion.location.line;
        locColumn = assertion.location.column;
      } else if (
        assertion.failureMessages &&
        assertion.failureMessages.length
      ) {
        const loc = parseFirstStackLocation(
          assertion.failureMessages.join("\n"),
        );
        if (loc) {
          locFile = loc.file || locFile;
          locLine = loc.line;
          locColumn = loc.column;
        }
      }
      items.push({
        file: locFile,
        line: locLine,
        column: locColumn,
        title: assertion.title,
        fullName: assertion.fullName,
        failureMessages: assertion.failureMessages || [],
      });
    }
  }
  if (testResult.failureMessage) {
    let locFile = relative;
    let locLine;
    let locColumn;
    const loc = parseFirstStackLocation(testResult.failureMessage);
    if (loc) {
      locFile = loc.file || locFile;
      locLine = loc.line;
      locColumn = loc.column;
    }
    items.push({
      file: locFile,
      line: locLine,
      column: locColumn,
      title: "Test file failure",
      fullName: `${relative} failed`,
      failureMessages: [testResult.failureMessage],
    });
  }
  return items;
}

class JestAIReporter {
  onRunComplete(_, aggregatedResults) {
    const output = {
      summary: {
        success: aggregatedResults.success,
        totalTests: aggregatedResults.numTotalTests,
        failedTests: aggregatedResults.numFailedTests,
        totalSuites: aggregatedResults.numTotalTestSuites,
        failedSuites: aggregatedResults.numFailedTestSuites,
      },
      failures: [],
      coverage: [],
    };

    // Collect failures
    for (const tr of aggregatedResults.testResults) {
      if (tr.numFailingTests > 0 || tr.testExecError) {
        output.failures.push(...formatFailure(tr));
      }
    }

    // Collect coverage for files that are not 100% across all four metrics
    const coverageMap = aggregatedResults.coverageMap;
    const addCoverageItem = (
      filePath,
      s,
      b,
      f,
      l,
      missedLines,
      uncoveredBranches,
    ) => {
      const allHundred = s === 100 && b === 100 && f === 100 && l === 100;
      if (!allHundred) {
        const fileRel = path.relative(process.cwd(), filePath);
        const lines = Array.isArray(missedLines) ? missedLines : [];
        const branches = Array.isArray(uncoveredBranches)
          ? uncoveredBranches
          : [];
        output.coverage.push({
          file: fileRel,
          stmts: pctStr(s),
          branch: pctStr(b),
          funcs: pctStr(f),
          lines: pctStr(l),
          missedLines: lines,
          uncoveredBranches: branches,
        });
      }
    };

    // Build a map from relative file path -> fileCoverage for quick lookup (if needed later)
    const fileCoverageByRel = new Map();
    if (coverageMap && typeof coverageMap.files === "function") {
      try {
        const files = coverageMap.files();
        for (const file of files) {
          const rel = path.relative(process.cwd(), file);
          try {
            const fc = coverageMap.fileCoverageFor(file);
            fileCoverageByRel.set(rel, fc);
          } catch (_) {
            // ignore individual file errors
          }
        }
      } catch (_) {
        // ignore errors building the map
      }
    }

    // Prefer in-memory coverage map for current-run truth.
    // Only fall back to coverage-summary.json if coverageMap is missing.
    if (coverageMap && typeof coverageMap.files === "function") {
      const files = coverageMap.files();
      for (const file of files) {
        const fileCoverage = coverageMap.fileCoverageFor(file);
        const summary = fileCoverage.toSummary();
        const missedLines = getMissedLinesOnlyFromFileCoverage(fileCoverage);
        const branches = getUncoveredBranchesFromFileCoverage(fileCoverage);
        addCoverageItem(
          fileCoverage.path || file,
          summary.statements.pct,
          summary.branches.pct,
          summary.functions.pct,
          summary.lines.pct,
          missedLines,
          branches,
        );
      }
    }

    // Sort coverage ascending by lowest metric to bubble the worst offenders
    if (output.coverage.length > 0) {
      output.coverage.sort((a, b) => {
        const minA = Math.min(
          parseFloat(a.stmts),
          parseFloat(a.branch),
          parseFloat(a.funcs),
          parseFloat(a.lines),
        );
        const minB = Math.min(
          parseFloat(b.stmts),
          parseFloat(b.branch),
          parseFloat(b.funcs),
          parseFloat(b.lines),
        );
        return minA - minB;
      });
    }

    // Print concise AI-friendly output
    // Failures first
    if (output.failures.length > 0) {
      console.log("\nFAILURES:");
      for (const f of output.failures) {
        const locSuffix =
          typeof f.line === "number" && typeof f.column === "number"
            ? `:${f.line}:${f.column}`
            : "";
        console.log(`- ${f.file}${locSuffix} :: ${f.fullName || f.title}`);
        // Print full message/stacktrace for verbosity
        for (const msg of f.failureMessages) {
          const lines = String(msg)
            .split("\n")
            .map((l) => (l.trim().length ? `  ${l}` : ""));
          for (const l of lines) console.log(l);
        }
      }
    }

    // Coverage shortfall (skippable via env when an external printer will handle it)
    const shouldPrintCoverage =
      String(process.env.AI_REPORTER_DISABLE_COVERAGE || "").trim() !== "1";
    if (shouldPrintCoverage && output.coverage.length > 0) {
      console.log("\nCOVERAGE BELOW 100%:");
      for (const c of output.coverage) {
        console.log(`- ${c.file}`);
        console.log(
          `  - Stmts: ${c.stmts} | Branch: ${c.branch} | Funcs: ${c.funcs} | Lines: ${c.lines}`,
        );
        if (Array.isArray(c.missedLines) && c.missedLines.length) {
          console.log(`  - Lines: ${formatLineRanges(c.missedLines)}`);
        }
        if (Array.isArray(c.uncoveredBranches) && c.uncoveredBranches.length) {
          const branchLines = Array.from(
            new Set(c.uncoveredBranches.map((b) => Number(b.line))),
          )
            .filter((n) => Number.isFinite(n) && n > 0)
            .sort((a, b) => a - b);
          const linesText = branchLines.join(", ");
          console.log(`  - Uncovered Branches on Lines: ${linesText}`);
          for (const b of c.uncoveredBranches) {
            if (typeof b.line === "number" && b.code && String(b.code).trim()) {
              const snippet = String(b.code).trim();
              // Limit snippet length to keep output compact
              const truncated =
                snippet.length > 200 ? `${snippet.slice(0, 200)}…` : snippet;
              console.log(`    ${b.line}: ${truncated}`);
            }
          }
        }
      }
    }

    // Final result one-liner
    const status = isFailure(aggregatedResults) ? "FAILED" : "PASSED";
    console.log(
      `\nRESULT: ${status} | Tests: ${aggregatedResults.numTotalTests}, Failed: ${aggregatedResults.numFailedTests}`,
    );
  }
}

module.exports = JestAIReporter;
