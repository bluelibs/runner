#!/usr/bin/env bash

# Script: get-pr-comments.sh
# Description: Fetches all comments (issue + review) for the open PR associated with the current branch.
# Why: Quickly review discussion and code review comments for the PR tied to your current work.
# Requirements: gh (GitHub CLI), jq, git
# Usage:
#   bash scripts/get-pr-comments.sh            # pretty print
#   bash scripts/get-pr-comments.sh --json     # JSON output
#   bash scripts/get-pr-comments.sh --branch my-feature-branch

set -euo pipefail

print_usage() {
  cat <<'USAGE'
Fetch comments for the open PR of the current (or specified) branch.

Options:
  --json               Output as JSON (combined array sorted by createdAt)
  --branch <name>      Use a specific branch instead of current
  -h, --help           Show help

Notes:
  - Requires: gh, jq, git
  - Looks up an OPEN PR for the branch. If none found, exits with message.
USAGE
}

ensure_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 127
  fi
}

to_human() {
  local pr_number="$1"
  local pr_title="$2"
  local combined_json="$3"

  echo "PR #$pr_number: $pr_title"
  echo
  if [[ $(jq 'length' <<<"$combined_json") -eq 0 ]]; then
    echo "No comments found."
    return 0
  fi

  jq -r '
    .[] |
    "----------------------------------------\n" +
    (
      "[" + (
        (.createdAt // "")
        | gsub("T"; " ")
        | sub("Z$"; "")
      ) + "] " +
      ((.type // "")) + " by " +
      ((.author // "")) +
      (if (.path // null) then
        " (" +
        ((.path // "")) +
        (
          if (.start_line // null) then
            ":" + ((.start_line | tostring)) + "-" + (((.line // .start_line) | tostring))
          elif (.line // null) then
            ":" + ((.line | tostring))
          else "" end
        ) +
        ")"
      else "" end)
    ) +
    "\n" + ((.url // "")) +
    "\n\n" + ((.body // "")) + "\n"
  ' <<<"$combined_json"
}

# Parse args
OUTPUT_JSON=false
BRANCH_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      OUTPUT_JSON=true; shift ;;
    --branch)
      BRANCH_OVERRIDE="${2:-}"; shift 2 ;;
    -h|--help)
      print_usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      print_usage; exit 2 ;;
  esac
done

# Ensure dependencies
ensure_cmd git
ensure_cmd gh
ensure_cmd jq

# Determine branch
BRANCH_NAME="${BRANCH_OVERRIDE:-}"
if [[ -z "$BRANCH_NAME" ]]; then
  BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  if [[ -z "$BRANCH_NAME" || "$BRANCH_NAME" == "HEAD" ]]; then
    echo "Cannot determine current branch (detached HEAD?). Use --branch <name>." >&2
    exit 1
  fi
fi

# Find OPEN PR for the branch
# Prefer an explicit list filter by headRefName to ensure we pick an open PR.
PR_NUMBER=$(gh pr list --state open --json headRefName,number -q \
  "map(select(.headRefName == \"$BRANCH_NAME\")) | .[0].number" 2>/dev/null || true)

if [[ -z "$PR_NUMBER" || "$PR_NUMBER" == "null" ]]; then
  # Fallback: try gh pr view using current context (may catch fork scenarios)
  if PR_NUMBER=$(gh pr view "$BRANCH_NAME" --json number -q .number 2>/dev/null || true); then
    :
  fi
fi

if [[ -z "$PR_NUMBER" || "$PR_NUMBER" == "null" ]]; then
  echo "No OPEN PR found for branch: $BRANCH_NAME" >&2
  exit 1
fi

# Fetch PR meta for header
PR_META=$(gh pr view "$PR_NUMBER" --json number,title -q '{number, title}')
PR_TITLE=$(jq -r '.title' <<<"$PR_META")

# Fetch issue comments (discussion) and review comments (code)
ISSUE_COMMENTS=$(gh api --paginate \
  "repos/:owner/:repo/issues/$PR_NUMBER/comments?per_page=100" \
  | jq -s 'add // []')

REVIEW_COMMENTS=$(gh api --paginate \
  "repos/:owner/:repo/pulls/$PR_NUMBER/comments?per_page=100" \
  | jq -s 'add // []')

# Normalise and combine
COMBINED=$(jq -n \
  --argjson issues "$ISSUE_COMMENTS" \
  --argjson reviews "$REVIEW_COMMENTS" '
  [
    ($issues  // []) | map({
      type: "issue",
      id: .id,
      author: .user.login,
      createdAt: .created_at,
      updatedAt: .updated_at,
      url: .html_url,
      body: .body
    }),
    ($reviews // []) | map({
      type: "review",
      id: .id,
      author: .user.login,
      createdAt: .created_at,
      updatedAt: .updated_at,
      url: .html_url,
      path: .path,
      line: (.line // .original_line),
      start_line: (.start_line // .original_start_line),
      body: .body
    })
  ] | add | sort_by(.createdAt)')

if $OUTPUT_JSON; then
  echo "$COMBINED"
else
  to_human "$PR_NUMBER" "$PR_TITLE" "$COMBINED"
fi
