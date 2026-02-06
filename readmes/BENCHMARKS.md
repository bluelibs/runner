# Benchmark System

← [Back to main README](../README.md)

This project includes a comprehensive benchmark system to track performance regressions over time.

## Overview

The benchmark system has been designed to be **statistically reliable** and **CI-friendly**, addressing the common issues with micro-benchmarks:

- Multiple runs with statistical analysis (median, percentiles)
- Proper warmup phases to stabilize JIT compilation
- Environment-aware thresholds (higher tolerance in CI)
- Severity classification (major vs minor regressions)
- Trend monitoring with warnings

## Running Benchmarks

### Full Benchmark Suite

```bash
# Run all benchmarks (takes ~2-3 minutes)
npx jest --config=config/jest/jest.bench.config.js

# Run with output to file
BENCHMARK_OUTPUT=results.json npx jest --config=config/jest/jest.bench.config.js
```

### Single Benchmark

```bash
npx jest --config=config/jest/jest.bench.config.js --testNamePattern="basic task execution"
```

## Benchmark Configuration

Configuration is stored in `config/benchmarks/benchmarks.config.json`:

```json
{
  "threshold": 0.3, // 30% tolerance for local runs
  "ciThreshold": 0.4, // 40% tolerance for CI runs
  "metricThresholds": {
    // Per-metric overrides
    "cacheMiddleware.speedupFactor": 0.2
  }
}
```

## Comparing Results

```bash
# Compare current results against baseline
node scripts/compare-benchmarks.mjs config/benchmarks/baseline.json config/benchmarks/benchmark-results.json config/benchmarks/benchmarks.config.json
```

The comparison script provides:

- **Environment detection** (CI vs Local)
- **Severity classification** (Major vs Minor regressions)
- **Trend warnings** for concerning changes within thresholds
- **Statistical context** showing actual vs expected values

## Updating Baselines

When performance characteristics legitimately change (new features, architectural changes):

```bash
# Update baseline with current environment
./scripts/update-baseline.sh
```

**Important:** Only update baselines when:

- You've made intentional performance changes
- The current environment is representative
- Changes have been reviewed and approved

## Statistical Approach

Each benchmark runs multiple times (3-5 runs) and reports:

- **Median** - Primary comparison metric (robust against outliers)
- **25th/75th percentiles** - Spread indication
- **Min/Max** - Full range
- **All values** - Complete transparency

This approach provides much more reliable results than single-run measurements.

## CI Integration

The system automatically:

- Detects CI environments and uses relaxed thresholds
- Only fails builds on **major regressions** (>60% by default)
- Shows **minor regressions** as warnings
- Provides context about environment differences

## Troubleshooting

### "Screaming CI" (False Positives)

If CI frequently fails with minor performance differences:

1. Increase `ciThreshold` in config (try 0.5-0.6)
2. Check if baseline was generated in similar environment
3. Consider updating baseline if environment has changed

### Inconsistent Results

If results vary wildly between runs:

1. Check for background processes during benchmarks
2. Ensure sufficient warmup iterations
3. Consider running fewer concurrent jobs in CI

### Major Regressions

If you see legitimate major regressions:

1. Identify the change that caused it
2. Determine if it's intentional (new feature trade-off)
3. Optimize the regression or update baseline if acceptable

## Best Practices

1. **Run benchmarks in consistent environments**
2. **Update baselines sparingly** - only when necessary
3. **Review benchmark changes** like any other code
4. **Monitor trends** - small consistent changes may indicate gradual regression
5. **Don't over-optimize** - focus on real-world performance impact
