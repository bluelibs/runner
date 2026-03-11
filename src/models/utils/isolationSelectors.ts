const REGEXP_SPECIAL_CHARACTERS = /[\\^$+?.()|[\]{}]/g;

/**
 * Why: isolate selectors allow wildcard ids, so bootstrap validation needs
 * one canonical check for "selector vs exact id".
 */
export function isWildcardSelector(value: string): boolean {
  return value.includes("*");
}

/**
 * Why: we compile once during bootstrap and then resolve to concrete ids to
 * keep runtime checks set-based and fast.
 */
export function compileIsolationSelectorPattern(selector: string): RegExp {
  const escapedSelector = selector.replace(REGEXP_SPECIAL_CHARACTERS, "\\$&");
  const pattern = escapedSelector.replace(/\*/g, "[^.]+");
  return new RegExp(`^${pattern}$`);
}

/**
 * Resolves a selector to concrete ids.
 *
 * Resolution order is intentional:
 * 1) exact id match wins (even if it contains "*")
 * 2) wildcard expansion (segment wildcard `*`)
 */
export function resolveIsolationSelector(
  selector: string,
  registeredIds: ReadonlySet<string>,
): string[] {
  if (registeredIds.has(selector)) {
    return [selector];
  }

  if (!isWildcardSelector(selector)) {
    return [];
  }

  const matcher = compileIsolationSelectorPattern(selector);
  const matches: string[] = [];
  for (const id of registeredIds) {
    if (matcher.test(id)) {
      matches.push(id);
    }
  }
  return matches;
}
