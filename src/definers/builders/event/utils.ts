import type { BuilderState } from "./types";

/**
 * Clones and patches the builder state immutably.
 */
export function clone<TPayload>(
  s: BuilderState<TPayload>,
  patch: Partial<BuilderState<TPayload>>,
): BuilderState<TPayload> {
  return Object.freeze({
    ...s,
    ...patch,
  });
}

/**
 * Generic array merge with override support.
 */
export function mergeArray<T>(
  existing: ReadonlyArray<T> | undefined,
  addition: ReadonlyArray<T>,
  override: boolean,
): T[] {
  const toArray = [...addition];
  if (override || !existing) {
    return toArray;
  }
  return [...existing, ...toArray];
}
