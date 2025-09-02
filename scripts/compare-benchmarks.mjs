#!/usr/bin/env node
import fs from 'node:fs';

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function get(obj, path) {
  return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
}

function formatPct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function main() {
  const [,, basePath, currentPath, configPath] = process.argv;
  if (!basePath || !currentPath || !configPath) {
    console.error('Usage: node scripts/compare-benchmarks.mjs <baseline.json> <current.json> <config.json>');
    process.exit(2);
  }

  const base = readJson(basePath);
  const cur = readJson(currentPath);
  const cfg = readJson(configPath);

  const threshold = cfg.threshold ?? 0.15; // 15% default
  const metrics = cfg.metrics || {};

  const failures = [];
  const notes = [];

  for (const [path, direction] of Object.entries(metrics)) {
    const baseVal = get(base.results, path);
    const curVal = get(cur.results, path);
    if (typeof baseVal !== 'number' || typeof curVal !== 'number') {
      notes.push(`Skip ${path}: missing numeric values (base=${baseVal}, current=${curVal})`);
      continue;
    }

    if (direction === 'higher') {
      const allowed = baseVal * (1 - threshold);
      if (curVal < allowed) {
        failures.push(`${path}: ${curVal} < ${allowed.toFixed(3)} (−${formatPct((baseVal - curVal)/baseVal)} vs base ${baseVal})`);
      }
    } else if (direction === 'lower') {
      const allowed = baseVal * (1 + threshold);
      if (curVal > allowed) {
        failures.push(`${path}: ${curVal} > ${allowed.toFixed(3)} (+${formatPct((curVal - baseVal)/baseVal)} vs base ${baseVal})`);
      }
    } else {
      notes.push(`Unknown direction for ${path}: ${direction}`);
    }
  }

  console.log('Benchmark comparison summary');
  console.log('Baseline meta:', base.meta);
  console.log('Current meta:', cur.meta);
  if (notes.length) {
    console.log('\nNotes:');
    for (const n of notes) console.log(' -', n);
  }

  if (failures.length) {
    console.error('\nRegressions detected:');
    for (const f of failures) console.error(' -', f);
    process.exit(1);
  }

  console.log('\nNo regressions beyond threshold.');
}

main();

