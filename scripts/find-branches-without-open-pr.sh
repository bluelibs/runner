#!/bin/bash
# Script: find-branches-without-open-pr.sh
# Description: Lists all remote branches that do not have an open pull request against them.
# Requirements: gh (GitHub CLI), jq
# Usage: bash find-branches-without-open-pr.sh


# Clean up after you review with care.
# bash scripts/find-branches-without-open-pr.sh > branches_to_delete.txt
# xargs -n 1 git push origin --delete < branches_to_delete.txt

set -euo pipefail

REMOTE=origin

# 1. Fetch latest remote branches
git fetch "$REMOTE"

# 2. List all remote branches (excluding HEAD, main, master)
git branch -r | grep -vE 'HEAD|main|master' | sed "s|$REMOTE/||" | sed 's/^[[:space:]]*//' | sort > all_branches.txt

# 3. List all open PRs and extract their source branches
gh pr list --state open --json headRefName -L 500 | jq -r '.[].headRefName' | sort > pr_branches.txt

# 4. Show branches that do not have an open PR
comm -23 all_branches.txt pr_branches.txt

# 5. Clean up
del_files=(all_branches.txt pr_branches.txt)
for f in "${del_files[@]}"; do
  [ -f "$f" ] && rm "$f"
done
