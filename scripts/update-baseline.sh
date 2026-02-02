#!/bin/bash
set -e

echo "Updating benchmark baseline..."

# Run full benchmarks and output to temporary file
BENCHMARK_OUTPUT=benchmarks/baseline.json npx jest --config=config/jest/jest.bench.config.js

# Check if benchmarks completed successfully
if [ -f "temp-baseline.json" ]; then
    # Move to baseline
    mv temp-baseline.json baseline.json
    echo "✅ Baseline updated successfully"
    
    # Show summary
    echo "New baseline summary:"
    echo "- Node: $(node -v)"
    echo "- Platform: $(uname -s)"
    echo "- CPU: $(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "unknown")"
    echo "- Timestamp: $(date -Iseconds)"
    
else
    echo "❌ Failed to generate benchmark results"
    exit 1
fi