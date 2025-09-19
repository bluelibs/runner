#!/usr/bin/env node
import fs from "fs";
import path from "path";

function readJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch (_) {
    return undefined;
  }
}

function pctStr(num) {
  const n = Math.round((Number(num) + Number.EPSILON) * 100) / 100;
  return `${n}%`;
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

function main() {
  const cwd = process.cwd();
  const finalPath = path.join(cwd, "coverage", "coverage-final.json");
  const lcovPath = path.join(cwd, "coverage", "lcov.info");
  const summaryPath = path.join(cwd, "coverage", "coverage-summary.json");

  const summary = readJson(summaryPath);
  const final = readJson(finalPath);
  const lcovContent = fs.existsSync(lcovPath)
    ? fs.readFileSync(lcovPath, "utf-8")
    : undefined;

  if (!final && !summary) {
    console.log("\nCOVERAGE: No coverage artifacts available.");
    return;
  }

  const files = [];

  const lcovBranches = new Map();
  const lcovLines = new Map();
  if (lcovContent) {
    let currentFile;
    for (const raw of lcovContent.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith("SF:")) {
        const filePath = line.slice(3).trim();
        const rel = filePath.includes(cwd)
          ? path.relative(cwd, filePath)
          : filePath;
        currentFile = rel;
        if (!lcovBranches.has(rel)) lcovBranches.set(rel, new Set());
        if (!lcovLines.has(rel)) lcovLines.set(rel, new Set());
      } else if (line.startsWith("DA:") && currentFile) {
        const rest = line.slice(3);
        const [lineNoStr, hitsStr] = rest.split(",");
        const lineNo = Number(lineNoStr);
        const hits = Number(hitsStr);
        if (Number.isFinite(lineNo) && hits === 0) {
          lcovLines.get(currentFile).add(lineNo);
        }
      } else if (line.startsWith("BRDA:") && currentFile) {
        const rest = line.slice(5);
        const [lineNoStr, , , takenStr] = rest.split(",");
        if (takenStr === "0") {
          const lineNo = Number(lineNoStr);
          if (Number.isFinite(lineNo) && lineNo > 0) {
            lcovBranches.get(currentFile).add(lineNo);
          }
        }
      } else if (line === "end_of_record") {
        currentFile = undefined;
      }
    }
  }

  if (!summary && final) {
    for (const [absFile, data] of Object.entries(final)) {
      if (!absFile || !data) continue;
      const rel = path.relative(cwd, absFile);
      if (!rel.startsWith("src/")) continue;
      if (rel.includes("/__tests__/")) continue;
      const s = data.s || {};
      const l = data.l || {};
      const f = data.f || {};
      const b = data.b || {};

      const counts = {
        stmts: { hit: 0, total: 0 },
        lines: { hit: 0, total: 0 },
        funcs: { hit: 0, total: 0 },
        branch: { hit: 0, total: 0 },
      };
      for (const v of Object.values(s)) {
        counts.stmts.total++;
        if (Number(v) > 0) counts.stmts.hit++;
      }
      for (const v of Object.values(l)) {
        counts.lines.total++;
        if (Number(v) > 0) counts.lines.hit++;
      }
      for (const v of Object.values(f)) {
        counts.funcs.total++;
        if (Number(v) > 0) counts.funcs.hit++;
      }
      for (const arr of Object.values(b)) {
        const a = Array.isArray(arr) ? arr : [];
        counts.branch.total += a.length;
        counts.branch.hit += a.filter((x) => Number(x) > 0).length;
      }

      const sPct = counts.stmts.total
        ? (counts.stmts.hit / counts.stmts.total) * 100
        : 100;
      const lPct = counts.lines.total
        ? (counts.lines.hit / counts.lines.total) * 100
        : 100;
      const fPct = counts.funcs.total
        ? (counts.funcs.hit / counts.funcs.total) * 100
        : 100;
      const bPct = counts.branch.total
        ? (counts.branch.hit / counts.branch.total) * 100
        : 100;

      const missedLines = Object.entries(l)
        .filter(([_, hits]) => Number(hits) === 0)
        .map(([lineStr]) => Number(lineStr))
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b);

      const lcovMiss = lcovBranches.get(rel);
      const branchLines = lcovMiss
        ? Array.from(lcovMiss).sort((a, b) => a - b)
        : [];

      const allHundred =
        Math.round(sPct) === 100 &&
        Math.round(lPct) === 100 &&
        Math.round(fPct) === 100 &&
        Math.round(bPct) === 100;
      if (!allHundred) {
        files.push({
          file: rel,
          stmts: pctStr(sPct),
          branch: pctStr(bPct),
          funcs: pctStr(fPct),
          lines: pctStr(lPct),
          missedLines,
          branchLines,
        });
      }
    }
  }

  if (summary) {
    for (const [filePath, metrics] of Object.entries(summary)) {
      if (filePath === "total") continue;
      if (!metrics || !metrics.statements) continue;
      const rel = path.relative(cwd, filePath);
      if (!rel.startsWith("src/")) continue;
      if (rel.includes("/__tests__/")) continue;
      const lcovMiss = lcovBranches.get(rel);
      const branchLines = lcovMiss
        ? Array.from(lcovMiss).sort((a, b) => a - b)
        : [];
      const missedLinesSet = lcovLines.get(rel);
      const missedLines = missedLinesSet
        ? Array.from(missedLinesSet).sort((a, b) => a - b)
        : [];
      const sPct = Number(metrics.statements.pct);
      const bPct = Number(metrics.branches.pct);
      const fPct = Number(metrics.functions.pct);
      const lPct = Number(metrics.lines.pct);
      const allHundred =
        Math.round(sPct) === 100 &&
        Math.round(bPct) === 100 &&
        Math.round(fPct) === 100 &&
        Math.round(lPct) === 100;
      if (!allHundred) {
        files.push({
          file: rel,
          stmts: pctStr(sPct),
          branch: pctStr(bPct),
          funcs: pctStr(fPct),
          lines: pctStr(lPct),
          missedLines,
          branchLines,
        });
      }
    }
  }

  if (files.length > 0) {
    files.sort((a, b) => {
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
    console.log("\nCOVERAGE BELOW 100%:");
    for (const c of files) {
      console.log(`- ${c.file}`);
      console.log(
        `  - Stmts: ${c.stmts} | Branch: ${c.branch} | Funcs: ${c.funcs} | Lines: ${c.lines}`,
      );
      if (Array.isArray(c.missedLines) && c.missedLines.length) {
        console.log(`  - Lines: ${formatLineRanges(c.missedLines)}`);
      }
      if (Array.isArray(c.branchLines) && c.branchLines.length) {
        console.log(
          `  - Uncovered Branches on Lines: ${c.branchLines.join(", ")}`,
        );
      }
    }
  }
}

main();
