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
  # Count total characters (prefer multi-byte; fallback to bytes to avoid locale issues)
  chars=$( (wc -m < "$file" 2>/dev/null || wc -c < "$file") | tr -d ' ')
  # Rough token estimate assuming ~4 characters per token (GPT-style tokenization)
  tokens=$(((chars + 3) / 4))

  if [ "$count" -gt "$THRESHOLD" ]; then
    # Store relative path for readability
    rel_path=${file#"$ROOT_DIR/"}
    # Store: <non-empty-lines> <chars> <tokens-est> <path>
    results+=("$count $chars $tokens $rel_path")
  fi
done < <(find "$SRC_DIR" -type f ! -name "*.test.ts" -print0)

if [[ ${#results[@]} -eq 0 ]]; then
  echo "No files over $THRESHOLD non-empty lines found under $SRC_DIR."
  exit 0
fi

# Styling for header (bold) and reset; works in most POSIX terminals.
# Pass as -v to awk for portability across implementations.
BOLD="$(printf '\033[1m')"
RESET="$(printf '\033[0m')"

# Sort by non-empty line count desc and print
# Aligned columns: non-empty-lines chars tokens-est path
printf "%s\n" "${results[@]}" \
  | sort -nr -k1,1 \
  | awk -v BOLD="$BOLD" -v RESET="$RESET" '
      BEGIN {
        header = sprintf("%-16s %-12s %-12s %s", "non-empty-lines", "chars", "tokens-est", "path");
        sep = "";
        for (i = 1; i <= length(header); i++) sep = sep "-";
        printf "%s%s%s\n%s\n", BOLD, header, RESET, sep;
      }
      {
        path="";
        for (i=4; i<=NF; i++) {
          path = path (i==4 ? "" : OFS) $i;
        }
        printf "%-16s %-12s %-12s %s\n", $1, $2, $3, path;
      }'
