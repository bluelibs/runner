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

export { mergeArray } from "../shared/mergeUtils";
