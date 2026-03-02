/**
 * Node v25 warns when `--localstorage-file` is present without a value.
 *
 * In some environments this malformed flag can be injected upstream (IDE/test
 * harness/npm wrapper) via NODE_OPTIONS or npm_config_node_options, even when
 * this repository does not set it explicitly.
 *
 * We keep this sanitizer intentionally narrow:
 * - It only removes invalid `--localstorage-file` occurrences.
 * - It preserves all other Node options unchanged.
 * - It preserves valid `--localstorage-file=<path>` and
 *   `--localstorage-file <path>` forms.
 */
function tokenizeNodeOptions(raw) {
  if (!raw) return [];
  const matches = String(raw).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  return matches ?? [];
}

function stripQuotes(value) {
  const text = String(value);
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function hasValue(valueToken) {
  if (!valueToken) return false;
  const value = stripQuotes(valueToken).trim();
  return value.length > 0;
}

export function sanitizeNodeOptionsString(raw) {
  const tokens = tokenizeNodeOptions(raw);
  if (tokens.length === 0) return raw;

  const sanitized = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    // Keep valid pair form, drop bare form with missing/invalid value.
    if (token === "--localstorage-file") {
      const nextToken = tokens[index + 1];
      if (nextToken && !nextToken.startsWith("--") && hasValue(nextToken)) {
        sanitized.push(token, nextToken);
        index += 1;
      }
      continue;
    }

    // Keep valid inline form, drop empty inline assignments.
    if (token.startsWith("--localstorage-file=")) {
      const valueToken = token.slice("--localstorage-file=".length);
      if (hasValue(valueToken)) {
        sanitized.push(token);
      }
      continue;
    }

    sanitized.push(token);
  }

  return sanitized.join(" ");
}

export function sanitizeNodeOptionEnv(env) {
  const nextEnv = { ...env };

  // NODE_OPTIONS affects all child Node processes (including Jest workers).
  if (typeof nextEnv.NODE_OPTIONS === "string") {
    const sanitized = sanitizeNodeOptionsString(nextEnv.NODE_OPTIONS);
    if (sanitized.trim().length === 0) {
      delete nextEnv.NODE_OPTIONS;
    } else {
      nextEnv.NODE_OPTIONS = sanitized;
    }
  }

  // npm can also forward node options via npm_config_node_options.
  if (typeof nextEnv.npm_config_node_options === "string") {
    const sanitized = sanitizeNodeOptionsString(
      nextEnv.npm_config_node_options,
    );
    if (sanitized.trim().length === 0) {
      delete nextEnv.npm_config_node_options;
    } else {
      nextEnv.npm_config_node_options = sanitized;
    }
  }

  return nextEnv;
}
