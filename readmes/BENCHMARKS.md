# Benchmark System

← [Back to main README](../README.md)

This project includes a comprehensive benchmark system to track performance regressions over time.

## Overview

The benchmark system has been designed to be **statistically reliable** and **CI-friendly**, addressing the common issues with micro-benchmarks:

- Multiple runs with statistical analysis (median, percentiles)
- Proper warmup phases to stabilize JIT compilation
- Environment-aware thresholds (higher tolerance in CI)
- Every configured threshold is enforced
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
  "threshold": 0.1, // 10% tolerance for local runs
  "ciThreshold": 0.15, // 15% tolerance for CI runs
  "metricThresholds": {
    // Per-metric overrides
    "cacheMiddleware.speedupFactor": 0.2
  }
}
```

The suite also tracks parallel runtime startup/disposal and the overhead of enabling execution
context. These measurements protect Runner's isolation and observability contracts as the runtime
evolves. Every execution-context sample measures both orders to avoid consistently favoring the
second, warmer code path. Every tracked metric fails CI on a regression beyond its configured
threshold. Missing, non-numeric, or non-finite measurements fail the comparison.

## Distribution Artifact Budgets

Built ESM artifacts have explicit byte budgets in
[`config/benchmarks/artifact-budgets.json`](../config/benchmarks/artifact-budgets.json).
Representative minified, tree-shaken browser-core and Node-durable consumers are budgeted
separately in
[`config/benchmarks/consumer-bundle-budgets.json`](../config/benchmarks/consumer-bundle-budgets.json).
Run both checks after building:

```bash
npm run build
npm run benchmark:artifacts
npm run benchmark:consumers
```

The budgets are regression guards, not size targets. Raise one only when a reviewed change
intentionally increases the public distribution.

## Comparing Results

```bash
# Compare current results against baseline
node scripts/compare-benchmarks.mjs config/benchmarks/baseline.json config/benchmarks/benchmark-results.json config/benchmarks/benchmarks.config.json
```

The comparison script provides:

- **Environment detection** (CI vs Local)
- **Strict thresholds**, including explicit zero-tolerance overrides
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
- Fails when any tracked metric exceeds its configured threshold
- Rejects missing results instead of falling back to stale files or stub measurements
- Runs the current benchmark workload against both revisions on the same runner
- Reads the threshold policy from the protected base revision
- Provides context about environment differences

Pull requests compare against their base revision. Pushes to `main` compare against the previous
`main` revision, so published changes receive the same regression checks.

## Troubleshooting

### "Screaming CI" (False Positives)

If CI frequently fails with minor performance differences:

1. Check for contention and repeat with identical workloads and environments
2. Inspect the raw sample distribution and warmup behavior
3. Change a threshold only after reviewing evidence that its tolerance is too narrow

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

Runtime task middleware and event metrics execute after runtime lock. Separate `initMiddlewareTaskExecution`
and `initEventEmissionAndHandling` metrics cover startup calls, where middleware composition remains mutable.
