import type { BuilderState } from "./types";

/**
 * Clones and patches the builder state immutably.
 */
export function clone<T>(
  s: BuilderState<T>,
  patch: Partial<BuilderState<T>>,
): BuilderState<T> {
  return Object.freeze({
    ...s,
    ...patch,
  });
}
