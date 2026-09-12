#!/usr/bin/env node
import fs from "node:fs";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function get(obj, path) {
  const value = path.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
  // Handle statistical data - use median if available, otherwise use the value directly
  if (value && typeof value === "object" && value.median !== undefined) {
    return value.median;
  }
  return value;
}

function formatPct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function isCI(currentMeta) {
  // Check if current benchmark was run in CI (preferred)
  if (currentMeta && currentMeta.isCI !== undefined) {
    return currentMeta.isCI;
  }

  // Fallback to process environment
  return !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.JENKINS_URL
  );
}

function getThreshold(cfg, metricPath, currentMeta) {
  // Use metric-specific threshold if available
  const metricThreshold = cfg.metricThresholds?.[metricPath];
  if (metricThreshold !== undefined) return metricThreshold;

  // Use CI threshold in CI environments
  if (isCI(currentMeta) && cfg.ciThreshold !== undefined)
    return cfg.ciThreshold;

  // Default threshold
  return cfg.threshold ?? 0.3;
}

function main() {
  const [, , basePath, currentPath, configPath] = process.argv;
  if (!basePath || !currentPath || !configPath) {
    console.error(
      "Usage: node scripts/compare-benchmarks.mjs <baseline.json> <current.json> <config.json>",
    );
    process.exit(2);
  }

  const base = readJson(basePath);
  const cur = readJson(currentPath);
  const cfg = readJson(configPath);

  const metrics = cfg.metrics || {};
  if (Object.keys(metrics).length === 0) {
    throw new Error("Benchmark config must contain tracked metrics.");
  }
  const isInCI = isCI(cur.meta);

  const failures = [];
  const notes = [];
  const warnings = [];

  if (isInCI) {
    notes.push("Running in CI environment - using relaxed thresholds");
  }

  for (const [path, direction] of Object.entries(metrics)) {
    const baseVal = get(base.results, path);
    const curVal = get(cur.results, path);
    const threshold = getThreshold(cfg, path, cur.meta);

    if (
      !Number.isFinite(baseVal) ||
      !Number.isFinite(curVal) ||
      baseVal < 0 ||
      curVal < 0
    ) {
      failures.push(
        `MAJOR invalid metric ${path}: expected finite non-negative values (base=${baseVal}, current=${curVal})`,
      );
      continue;
    }

    const change = (curVal - baseVal) / baseVal;
    const changeStr = formatPct(Math.abs(change));
    if (!Number.isFinite(threshold) || threshold < 0) {
      failures.push(`MAJOR invalid threshold for ${path}: ${threshold}`);
      continue;
    }

    if (direction === "higher") {
      const allowed = baseVal * (1 - threshold);
      if (curVal < allowed) {
        failures.push(
          `MAJOR regression in ${path}: ${curVal} < ${allowed.toFixed(3)} (−${changeStr} vs base ${baseVal}, threshold: ${formatPct(threshold)})`,
        );
      } else if (change < -threshold * 0.5) {
        warnings.push(
          `${path} trending down: −${changeStr} (within ${formatPct(threshold)} threshold)`,
        );
      }
    } else if (direction === "lower") {
      const allowed = baseVal * (1 + threshold);
      if (curVal > allowed) {
        failures.push(
          `MAJOR regression in ${path}: ${curVal} > ${allowed.toFixed(3)} (+${changeStr} vs base ${baseVal}, threshold: ${formatPct(threshold)})`,
        );
      } else if (change > threshold * 0.5) {
        warnings.push(
          `${path} trending up: +${changeStr} (within ${formatPct(threshold)} threshold)`,
        );
      }
    } else {
      failures.push(`MAJOR unknown direction for ${path}: ${direction}`);
    }
  }

  console.log("Benchmark comparison summary");
  console.log("Baseline meta:", base.meta);
  console.log("Current meta:", cur.meta);
  console.log(`Environment: ${isInCI ? "CI" : "Local"}`);

  if (notes.length) {
    console.log("\nNotes:");
    for (const n of notes) console.log(" -", n);
  }

  if (warnings.length) {
    console.log("\nWarnings (trends to watch):");
    for (const w of warnings) console.log(" -", w);
  }

  if (failures.length) {
    console.error("\nBenchmark checks failed:");
    for (const failure of failures) console.error(" -", failure);
    process.exit(1);
  }

  console.log("\nNo significant regressions detected.");
}

main();
