#!/usr/bin/env node
import fs from 'node:fs';

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function get(obj, path) {
  const value = path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
  // Handle statistical data - use median if available, otherwise use the value directly
  if (value && typeof value === 'object' && value.median !== undefined) {
    return value.median;
  }
  return value;
}

function getStatInfo(obj, path) {
  const value = path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
  if (value && typeof value === 'object' && value.median !== undefined) {
    return {
      value: value.median,
      isStatistical: true,
      min: value.min,
      max: value.max,
      variance: ((value.max - value.min) / value.median * 100).toFixed(1)
    };
  }
  return {
    value: value,
    isStatistical: false,
    variance: 'N/A'
  };
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
  return !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.JENKINS_URL);
}

function getThreshold(cfg, metricPath, currentMeta) {
  // Use metric-specific threshold if available
  const metricThreshold = cfg.metricThresholds?.[metricPath];
  if (metricThreshold) return metricThreshold;
  
  // Use CI threshold in CI environments
  if (isCI(currentMeta) && cfg.ciThreshold) return cfg.ciThreshold;
  
  // Default threshold
  return cfg.threshold ?? 0.3;
}

function calculateStats(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  
  const sorted = [...values].sort((a, b) => a - b);
  const len = sorted.length;
  
  return {
    min: sorted[0],
    max: sorted[len - 1],
    median: len % 2 === 0 
      ? (sorted[len / 2 - 1] + sorted[len / 2]) / 2 
      : sorted[Math.floor(len / 2)],
    mean: values.reduce((a, b) => a + b, 0) / len,
    p25: sorted[Math.floor(len * 0.25)],
    p75: sorted[Math.floor(len * 0.75)]
  };
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

  const metrics = cfg.metrics || {};
  const isInCI = isCI(cur.meta);

  const failures = [];
  const notes = [];
  const warnings = [];

  if (isInCI) {
    notes.push('Running in CI environment - using relaxed thresholds');
  }

  // Check for format compatibility issues
  let hasFormatMismatch = false;
  let statisticalMetricsCount = 0;
  let oldFormatMetricsCount = 0;

  for (const [path, direction] of Object.entries(metrics)) {
    const baseInfo = getStatInfo(base.results, path);
    const curInfo = getStatInfo(cur.results, path);
    
    if (curInfo.isStatistical) statisticalMetricsCount++;
    if (baseInfo.value !== undefined && !baseInfo.isStatistical) oldFormatMetricsCount++;
    
    if (baseInfo.value !== undefined && curInfo.value !== undefined && 
        baseInfo.isStatistical !== curInfo.isStatistical) {
      hasFormatMismatch = true;
    }
  }

  if (hasFormatMismatch) {
    notes.push(`⚠️  Format mismatch detected: baseline uses ${oldFormatMetricsCount ? 'single-value' : 'statistical'} format, current uses ${statisticalMetricsCount ? 'statistical' : 'single-value'} format`);
    notes.push('This may cause apparent regressions during format transition. Consider updating baseline.');
  }

  for (const [path, direction] of Object.entries(metrics)) {
    const baseVal = get(base.results, path);
    const curVal = get(cur.results, path);
    const threshold = getThreshold(cfg, path, cur.meta);
    
    if (typeof baseVal !== 'number' || typeof curVal !== 'number') {
      notes.push(`Skip ${path}: missing numeric values (base=${baseVal}, current=${curVal})`);
      continue;
    }

    const change = (curVal - baseVal) / baseVal;
    const changeStr = formatPct(Math.abs(change));

    // Check if this specific metric has a format mismatch
    const baseInfo = getStatInfo(base.results, path);
    const curInfo = getStatInfo(cur.results, path);
    const isFormatMismatch = baseInfo.isStatistical !== curInfo.isStatistical;

    // Use more lenient threshold during format transitions
    let effectiveThreshold = threshold;
    if (isFormatMismatch && hasFormatMismatch) {
      effectiveThreshold = Math.max(threshold, 0.6); // At least 60% tolerance during transition
    }

    if (direction === 'higher') {
      const allowed = baseVal * (1 - effectiveThreshold);
      if (curVal < allowed) {
        const severity = Math.abs(change) > effectiveThreshold * 2 ? 'MAJOR' : 'minor';
        const formatNote = isFormatMismatch ? ' [format mismatch]' : '';
        failures.push(`${severity} regression in ${path}: ${curVal} < ${allowed.toFixed(3)} (−${changeStr} vs base ${baseVal}, threshold: ${formatPct(effectiveThreshold)})${formatNote}`);
      } else if (change < -effectiveThreshold * 0.5) {
        warnings.push(`${path} trending down: −${changeStr} (within ${formatPct(effectiveThreshold)} threshold)`);
      }
    } else if (direction === 'lower') {
      const allowed = baseVal * (1 + effectiveThreshold);
      if (curVal > allowed) {
        const severity = Math.abs(change) > effectiveThreshold * 2 ? 'MAJOR' : 'minor';
        const formatNote = isFormatMismatch ? ' [format mismatch]' : '';
        failures.push(`${severity} regression in ${path}: ${curVal} > ${allowed.toFixed(3)} (+${changeStr} vs base ${baseVal}, threshold: ${formatPct(effectiveThreshold)})${formatNote}`);
      } else if (change > effectiveThreshold * 0.5) {
        warnings.push(`${path} trending up: +${changeStr} (within ${formatPct(effectiveThreshold)} threshold)`);
      }
    } else {
      notes.push(`Unknown direction for ${path}: ${direction}`);
    }
  }

  console.log('Benchmark comparison summary');
  console.log('Baseline meta:', base.meta);
  console.log('Current meta:', cur.meta);
  console.log(`Environment: ${isInCI ? 'CI' : 'Local'}`);
  
  if (notes.length) {
    console.log('\nNotes:');
    for (const n of notes) console.log(' -', n);
  }

  if (warnings.length) {
    console.log('\nWarnings (trends to watch):');
    for (const w of warnings) console.log(' -', w);
  }

  if (failures.length) {
    const majorFailures = failures.filter(f => f.includes('MAJOR'));
    const minorFailures = failures.filter(f => f.includes('minor'));
    
    if (majorFailures.length) {
      console.error('\nMAJOR regressions detected:');
      for (const f of majorFailures) console.error(' -', f);
    }
    
    if (minorFailures.length) {
      console.log('\nMinor regressions detected:');
      for (const f of minorFailures) console.log(' -', f);
    }
    
    // Only fail on major regressions in CI
    if (majorFailures.length > 0 || (!isInCI && failures.length > 0)) {
      process.exit(1);
    }
  }

  console.log('\nNo significant regressions detected.');
}

main();

