import type { BuilderState } from "./types";

/**
 * Clones and patches the builder state immutably.
 */
export function clone<TPayload, TTransactional extends boolean | undefined>(
  s: BuilderState<TPayload, TTransactional>,
  patch: Partial<BuilderState<TPayload, TTransactional>>,
): BuilderState<TPayload, TTransactional> {
  return Object.freeze({
    ...s,
    ...patch,
  });
}

export { mergeArray } from "../shared/mergeUtils";
