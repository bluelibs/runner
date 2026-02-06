#!/bin/bash
set -e

echo "Updating benchmark baseline..."

# Run full benchmarks and output to temporary file
TEMP_BASELINE="config/benchmarks/temp-baseline.json"
BENCHMARK_OUTPUT=$TEMP_BASELINE npx jest --config=config/jest/jest.bench.config.js

# Check if benchmarks completed successfully
if [ -f "$TEMP_BASELINE" ]; then
    # Move to baseline
    mv "$TEMP_BASELINE" "config/benchmarks/baseline.json"
    echo "✅ Baseline updated successfully"
    
    # Show summary
    echo "New baseline summary:"
    echo "- Node: $(node -v)"
    echo "- Platform: $(uname -s)"
    echo "- CPU: $(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "unknown")"
    echo "- Timestamp: $(date -Iseconds)"
    
else
    echo "❌ Failed to generate benchmark results (expected $TEMP_BASELINE)"
    exit 1
fi