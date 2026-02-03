#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { isInCoverageScope, toPosixPath } from "./coverage-scope.mjs";

function readJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch (_) {
    return undefined;
  }
}

function round(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function pctStr(num) {
  return `${round(Number(num))}%`;
}

function formatLineRanges(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return "";
  const sorted = Array.from(
    new Set(lines.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)),
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

function computePct(hit, total) {
  if (!Number.isFinite(total) || total <= 0) return 100;
  return (hit / total) * 100;
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
    branchHits && typeof branchHits === "object" ? Object.values(branchHits) : [];
  let total = 0;
  let hit = 0;
  for (const arr of entries) {
    const a = Array.isArray(arr) ? arr : [];
    total += a.length;
    hit += a.filter((x) => Number(x) > 0).length;
  }
  return { hit, total };
}

function getMissedLinesFromFinalEntry(entry) {
  const missed = [];
  const lineHits = entry && entry.l && typeof entry.l === "object" ? entry.l : {};
  for (const [lineStr, hits] of Object.entries(lineHits)) {
    const line = Number(lineStr);
    if (Number.isFinite(line) && Number(hits) === 0) missed.push(line);
  }
  missed.sort((a, b) => a - b);
  return missed;
}

function getMissedStatementLinesFromFinalEntry(entry) {
  const missed = new Set();
  try {
    const statementHits =
      entry && entry.s && typeof entry.s === "object" ? entry.s : {};
    const statementMap =
      entry && entry.statementMap && typeof entry.statementMap === "object"
        ? entry.statementMap
        : {};
    for (const [statementId, hits] of Object.entries(statementHits)) {
      if (Number(hits) !== 0) continue;
      const loc = statementMap[statementId];
      const line = loc && loc.start && Number(loc.start.line);
      if (Number.isFinite(line) && line > 0) missed.add(line);
    }
  } catch (_) {
    // ignore
  }
  return Array.from(missed).sort((a, b) => a - b);
}

function getMissedFunctionLinesFromFinalEntry(entry) {
  const missed = new Set();
  try {
    const functionHits =
      entry && entry.f && typeof entry.f === "object" ? entry.f : {};
    const fnMap =
      entry && entry.fnMap && typeof entry.fnMap === "object" ? entry.fnMap : {};
    for (const [fnId, hits] of Object.entries(functionHits)) {
      if (Number(hits) !== 0) continue;
      const mapEntry = fnMap[fnId];
      const loc = (mapEntry && mapEntry.decl) || (mapEntry && mapEntry.loc);
      const line = loc && loc.start && Number(loc.start.line);
      if (Number.isFinite(line) && line > 0) missed.add(line);
    }
  } catch (_) {
    // ignore
  }
  return Array.from(missed).sort((a, b) => a - b);
}

function getUncoveredBranchLinesFromFinalEntry(entry) {
  const lines = new Set();
  try {
    const branchMap =
      entry && entry.branchMap && typeof entry.branchMap === "object"
        ? entry.branchMap
        : {};
    const branchHits =
      entry && entry.b && typeof entry.b === "object" ? entry.b : {};
    for (const [branchId, counts] of Object.entries(branchHits)) {
      const countArr = Array.isArray(counts) ? counts : [];
      const mapEntry = branchMap[branchId];
      for (let i = 0; i < countArr.length; i++) {
        if (Number(countArr[i]) !== 0) continue;
        const loc =
          (mapEntry && mapEntry.locations && mapEntry.locations[i]) ||
          (mapEntry && mapEntry.loc) ||
          undefined;
        const line = loc && loc.start && Number(loc.start.line);
        if (Number.isFinite(line) && line > 0) lines.add(line);
      }
    }
  } catch (_) {
    // ignore
  }
  return Array.from(lines).sort((a, b) => a - b);
}

function main() {
  const cwd = process.cwd();
  const coverageDir = path.join(cwd, "coverage");
  const finalPath = path.join(coverageDir, "coverage-final.json");
  const summaryPath = path.join(coverageDir, "coverage-summary.json");
  const lcovPath = path.join(coverageDir, "lcov.info");

  const final = readJson(finalPath);
  const summary = readJson(summaryPath);
  const lcovContent = fs.existsSync(lcovPath)
    ? fs.readFileSync(lcovPath, "utf-8")
    : undefined;

  if (!final && !summary) {
    console.log("\nCOVERAGE: No coverage artifacts available.");
    return;
  }

  const files = [];

  if (final) {
    for (const [absFile, entry] of Object.entries(final)) {
      if (!absFile || !entry) continue;
      const relPosix = toPosixPath(path.relative(cwd, absFile));
      if (!isInCoverageScope(relPosix)) continue;

      const stmtCounts = computeCounts(entry.s);
      const lineCounts = computeCounts(entry.l);
      const funcCounts = computeCounts(entry.f);
      const branchCounts = computeBranchCounts(entry.b);

      const stmtsPct = computePct(stmtCounts.hit, stmtCounts.total);
      const linesPct = computePct(lineCounts.hit, lineCounts.total);
      const funcsPct = computePct(funcCounts.hit, funcCounts.total);
      const branchPct = computePct(branchCounts.hit, branchCounts.total);

      const allHundred =
        stmtCounts.hit === stmtCounts.total &&
        lineCounts.hit === lineCounts.total &&
        funcCounts.hit === funcCounts.total &&
        branchCounts.hit === branchCounts.total;
      if (allHundred) continue;

      files.push({
        file: relPosix,
        stmtsPct,
        linesPct,
        funcsPct,
        branchPct,
        stmts: pctStr(stmtsPct),
        lines: pctStr(linesPct),
        funcs: pctStr(funcsPct),
        branch: pctStr(branchPct),
        missedLines: getMissedLinesFromFinalEntry(entry),
        missedStatementLines: getMissedStatementLinesFromFinalEntry(entry),
        missedFunctionLines: getMissedFunctionLinesFromFinalEntry(entry),
        uncoveredBranchLines: getUncoveredBranchLinesFromFinalEntry(entry),
      });
    }
  } else if (summary) {
    const lcovBranches = new Map();
    const lcovLines = new Map();
    if (lcovContent) {
      let currentFile;
      for (const raw of lcovContent.split(/\r?\n/)) {
        const line = raw.trim();
        if (line.startsWith("SF:")) {
          const filePath = toPosixPath(path.normalize(line.slice(3).trim()));
          const relPosix = toPosixPath(
            path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath,
          );
          currentFile = relPosix;
          if (!lcovBranches.has(relPosix)) lcovBranches.set(relPosix, new Set());
          if (!lcovLines.has(relPosix)) lcovLines.set(relPosix, new Set());
        } else if (line.startsWith("DA:") && currentFile) {
          const [lineNoStr, hitsStr] = line.slice(3).split(",");
          const lineNo = Number(lineNoStr);
          const hits = Number(hitsStr);
          if (Number.isFinite(lineNo) && hits === 0) lcovLines.get(currentFile).add(lineNo);
        } else if (line.startsWith("BRDA:") && currentFile) {
          const [lineNoStr, , , takenStr] = line.slice(5).split(",");
          const lineNo = Number(lineNoStr);
          if (Number.isFinite(lineNo) && takenStr === "0")
            lcovBranches.get(currentFile).add(lineNo);
        } else if (line === "end_of_record") {
          currentFile = undefined;
        }
      }
    }

    for (const [filePath, metrics] of Object.entries(summary)) {
      if (filePath === "total") continue;
      if (!metrics || !metrics.statements) continue;
      const relPosix = toPosixPath(path.relative(cwd, filePath));
      if (!isInCoverageScope(relPosix)) continue;

      const stmtsPct = Number(metrics.statements.pct);
      const branchPct = Number(metrics.branches.pct);
      const funcsPct = Number(metrics.functions.pct);
      const linesPct = Number(metrics.lines.pct);
      const allHundred =
        stmtsPct === 100 && branchPct === 100 && funcsPct === 100 && linesPct === 100;
      if (allHundred) continue;

      const missedLinesSet = lcovLines.get(relPosix);
      const missedLines = missedLinesSet
        ? Array.from(missedLinesSet).sort((a, b) => a - b)
        : [];
      const branchLinesSet = lcovBranches.get(relPosix);
      const uncoveredBranchLines = branchLinesSet
        ? Array.from(branchLinesSet).sort((a, b) => a - b)
        : [];

      files.push({
        file: relPosix,
        stmtsPct,
        linesPct,
        funcsPct,
        branchPct,
        stmts: pctStr(stmtsPct),
        lines: pctStr(linesPct),
        funcs: pctStr(funcsPct),
        branch: pctStr(branchPct),
        missedLines,
        missedStatementLines: [],
        missedFunctionLines: [],
        uncoveredBranchLines,
      });
    }
  }

  if (files.length === 0) return;

  files.sort((a, b) => {
    const minA = Math.min(a.stmtsPct, a.branchPct, a.funcsPct, a.linesPct);
    const minB = Math.min(b.stmtsPct, b.branchPct, b.funcsPct, b.linesPct);
    return minA - minB;
  });

  console.log("\nCOVERAGE BELOW 100%:");
  for (const c of files) {
    console.log(`- ${c.file}`);
    console.log(
      `  - Stmts: ${c.stmts} | Branch: ${c.branch} | Funcs: ${c.funcs} | Lines: ${c.lines}`,
    );
    if (Array.isArray(c.missedLines) && c.missedLines.length) {
      console.log(`  - Lines: ${formatLineRanges(c.missedLines)}`);
    }
    if (Array.isArray(c.missedStatementLines) && c.missedStatementLines.length) {
      console.log(
        `  - Missed Statements on Lines: ${formatLineRanges(c.missedStatementLines)}`,
      );
    }
    if (Array.isArray(c.missedFunctionLines) && c.missedFunctionLines.length) {
      console.log(
        `  - Missed Functions on Lines: ${formatLineRanges(c.missedFunctionLines)}`,
      );
    }
    if (Array.isArray(c.uncoveredBranchLines) && c.uncoveredBranchLines.length) {
      console.log(
        `  - Uncovered Branches on Lines: ${c.uncoveredBranchLines.join(", ")}`,
      );
    }
  }
}

main();
