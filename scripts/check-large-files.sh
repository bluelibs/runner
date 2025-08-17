#!/usr/bin/env bash
set -euo pipefail

# Detect project root based on this script's location
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT_DIR/src"

# Threshold for number of non-empty lines to flag
# Priority: first CLI arg > THRESHOLD env var > default 200
THRESHOLD_DEFAULT=200
THRESHOLD_FROM_ENV="${THRESHOLD:-}"
THRESHOLD_FROM_ARG="${1:-}"

if [[ -n "$THRESHOLD_FROM_ARG" ]]; then
  if [[ "$THRESHOLD_FROM_ARG" =~ ^[0-9]+$ ]]; then
    THRESHOLD="$THRESHOLD_FROM_ARG"
  else
    echo "Invalid threshold: $THRESHOLD_FROM_ARG (must be a positive integer)" >&2
    exit 2
  fi
elif [[ -n "$THRESHOLD_FROM_ENV" ]]; then
  if [[ "$THRESHOLD_FROM_ENV" =~ ^[0-9]+$ ]]; then
    THRESHOLD="$THRESHOLD_FROM_ENV"
  else
    echo "Invalid THRESHOLD env var: $THRESHOLD_FROM_ENV (must be a positive integer)" >&2
    exit 2
  fi
else
  THRESHOLD="$THRESHOLD_DEFAULT"
fi

if [[ ! -d "$SRC_DIR" ]]; then
  echo "src directory not found at $SRC_DIR" >&2
  exit 1
fi

results=()

# Find all files under src excluding *.test.ts (null-delimited for safety)
while IFS= read -r -d '' file; do
  # Count non-empty lines (approx. LOC)
  count=$(grep -cEv '^[[:space:]]*$' "$file" || true)

  if [ "$count" -gt "$THRESHOLD" ]; then
    results+=("$count $file")
  fi
done < <(find "$SRC_DIR" -type f ! -name "*.test.ts" -print0)

if [[ ${#results[@]} -eq 0 ]]; then
  echo "No files over $THRESHOLD non-empty lines found under $SRC_DIR."
  exit 0
fi

# Sort by count desc and print
printf "%s\n" "${results[@]}" | sort -nr -k1,1 | awk '{printf "%s\t%s\n", $1, $2}'


