#!/usr/bin/env bash
# Thin passthrough — delegates to check-file-sizes.mjs which strips comments
# before counting lines and covers all .ts/.tsx/.js/.jsx/.mjs including tests.
exec node "$(dirname "$0")/check-file-sizes.mjs" --mode=large "$@"
