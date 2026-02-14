const ESCAPE_PREFIX = "$runner.escape::";

const ESCAPED_MARKER_KEYS = new Set(["__type", "__graph"]);

export const escapeReservedMarkerKey = (key: string): string => {
  if (ESCAPED_MARKER_KEYS.has(key) || key.startsWith(ESCAPE_PREFIX)) {
    return `${ESCAPE_PREFIX}${key}`;
  }
  return key;
};

export const unescapeReservedMarkerKey = (key: string): string => {
  if (key.startsWith(ESCAPE_PREFIX)) {
    return key.slice(ESCAPE_PREFIX.length);
  }
  return key;
};
