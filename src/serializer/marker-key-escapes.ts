const ESCAPE_PREFIX = "$runner.escape::";
const UNDERSCORE_CHAR_CODE = 95; // '_'
const DOLLAR_CHAR_CODE = 36; // '$'

export const escapeReservedMarkerKey = (key: string): string => {
  const firstCode = key.charCodeAt(0);
  if (firstCode === UNDERSCORE_CHAR_CODE) {
    if (key === "__type" || key === "__graph") {
      return `${ESCAPE_PREFIX}${key}`;
    }
    return key;
  }
  if (firstCode === DOLLAR_CHAR_CODE && key.startsWith(ESCAPE_PREFIX)) {
    return `${ESCAPE_PREFIX}${key}`;
  }
  return key;
};

export const unescapeReservedMarkerKey = (key: string): string => {
  if (key.charCodeAt(0) === DOLLAR_CHAR_CODE && key.startsWith(ESCAPE_PREFIX)) {
    return key.slice(ESCAPE_PREFIX.length);
  }
  return key;
};
