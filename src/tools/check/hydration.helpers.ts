import {
  ClassPattern,
  LazyPattern,
  MapOfPattern,
  MaybePattern,
  NonEmptyArrayPattern,
  ObjectIncludingPattern,
  ObjectStrictPattern,
  OneOfPattern,
  OptionalPattern,
  WithErrorPolicyPattern,
  WithMessagePattern,
} from "./matcher";

type PatternVisitState = WeakSet<object>;

// This limits only the cheap "can this pattern ever hydrate?" probe.
// It does not cap payload depth or hydrated object depth.
const MAX_HYDRATION_PATTERN_PROBE_DEPTH = 32;

function isObjectReference(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

function hasHydratableEntries(
  pattern: Record<string, unknown>,
  activePatterns: PatternVisitState,
  depth: number,
): boolean {
  for (const childPattern of Object.values(pattern)) {
    if (patternCanHydrate(childPattern, activePatterns, depth - 1)) {
      return true;
    }
  }

  return false;
}

export function patternCanHydrate(
  pattern: unknown,
  activePatterns: PatternVisitState = new WeakSet<object>(),
  depth = MAX_HYDRATION_PATTERN_PROBE_DEPTH,
): boolean {
  if (depth <= 0) {
    // Recursive Match.Lazy resolvers may allocate fresh wrapper objects each
    // time they resolve, so pair-tracking alone is not enough to guarantee
    // termination for a cheap "can this hydrate?" probe. Hitting this guard
    // means "skip hydration probing here", not "schema validation fails".
    return false;
  }
  if (pattern instanceof ClassPattern) return true;
  if (pattern instanceof OptionalPattern || pattern instanceof MaybePattern) {
    return patternCanHydrate(pattern.pattern, activePatterns, depth - 1);
  }
  if (
    pattern instanceof WithMessagePattern ||
    pattern instanceof WithErrorPolicyPattern
  ) {
    return patternCanHydrate(pattern.pattern, activePatterns, depth - 1);
  }
  if (pattern instanceof LazyPattern) {
    if (activePatterns.has(pattern)) return false;
    activePatterns.add(pattern);
    return patternCanHydrate(pattern.resolve(), activePatterns, depth - 1);
  }
  if (pattern instanceof OneOfPattern) {
    return pattern.patterns.some((childPattern: unknown) =>
      patternCanHydrate(childPattern, activePatterns, depth - 1),
    );
  }
  if (pattern instanceof NonEmptyArrayPattern) {
    return (
      pattern.pattern !== undefined &&
      patternCanHydrate(pattern.pattern, activePatterns, depth - 1)
    );
  }
  if (pattern instanceof MapOfPattern) {
    return patternCanHydrate(pattern.pattern, activePatterns, depth - 1);
  }
  if (
    pattern instanceof ObjectIncludingPattern ||
    pattern instanceof ObjectStrictPattern
  ) {
    if (activePatterns.has(pattern)) return false;
    activePatterns.add(pattern);
    return hasHydratableEntries(pattern.pattern, activePatterns, depth);
  }
  if (Array.isArray(pattern)) {
    return (
      pattern.length === 1 &&
      patternCanHydrate(pattern[0], activePatterns, depth - 1)
    );
  }
  if (isObjectReference(pattern)) {
    if (activePatterns.has(pattern)) return false;
    activePatterns.add(pattern);
    return hasHydratableEntries(
      pattern as Record<string, unknown>,
      activePatterns,
      depth,
    );
  }

  return false;
}

export function copyHydratedProperty(
  target: object,
  key: string | symbol,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

export function getHydratedReference(
  value: unknown,
  seen: WeakMap<object, unknown>,
): unknown {
  if (!isObjectReference(value)) {
    return value;
  }

  return seen.get(value) ?? value;
}

export function getSeenHydratedValue(
  value: unknown,
  seen: WeakMap<object, unknown>,
): unknown {
  if (!isObjectReference(value)) {
    return undefined;
  }

  return seen.get(value);
}

export function rememberHydratedValue(
  source: unknown,
  hydrated: unknown,
  seen: WeakMap<object, unknown>,
): void {
  if (!isObjectReference(source)) {
    return;
  }

  seen.set(source, hydrated);
}
