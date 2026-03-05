/**
 * Shared type-checking predicates used across definers, serializer, and check modules.
 * Centralised here to eliminate scattered near-identical copies.
 */

// ── Class constructor detection ──────────────────────────────────────────────

type AbstractClassConstructor = abstract new (...args: never[]) => unknown;

/**
 * Guards whether a value is a class constructor (not a plain function/arrow).
 * Checks prototype chain identity to distinguish classes from arrow functions.
 */
export function isClassConstructor(
  value: unknown,
): value is AbstractClassConstructor {
  if (typeof value !== "function") return false;

  const prototype = (value as { prototype?: unknown }).prototype;
  if (!prototype || typeof prototype !== "object") return false;

  return (prototype as { constructor?: unknown }).constructor === value;
}

// ── Prototype chain walker ───────────────────────────────────────────────────

/**
 * Walks the prototype chain from base → derived, collecting each constructor.
 * Used by classSchema and serializer field-metadata to resolve inherited fields.
 */
export function getClassChain(target: Function): Function[] {
  const chain: Function[] = [];
  let currentPrototype = target.prototype;

  while (currentPrototype && currentPrototype !== Object.prototype) {
    const constructor = currentPrototype.constructor as Function;
    if (typeof constructor !== "function") break;
    chain.push(constructor);
    currentPrototype = Object.getPrototypeOf(currentPrototype);
  }

  return chain.reverse();
}

// ── Plain-object detection ───────────────────────────────────────────────────

/**
 * Returns true when the value is a plain `{}` or `Object.create(null)`.
 * Rejects class instances, arrays, Date, etc.
 */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// ── Parse-function detection ─────────────────────────────────────────────────

/**
 * Guards whether a value exposes a `.parse(input)` method (validation schema contract).
 */
export function hasParseFunction<T>(
  value: unknown,
): value is { parse(input: unknown): T } {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null
  ) {
    return false;
  }

  return typeof (value as { parse?: unknown }).parse === "function";
}

// ── Object-record guard ──────────────────────────────────────────────────────

/**
 * Narrows to a non-null, non-array object record.
 */
export function isObjectRecord(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
