import type { DefaultErrorType } from "../../../defs";
import type { BuilderState } from "./types";

/**
 * Clones and patches the builder state immutably.
 */
export function clone<TData extends DefaultErrorType>(
  s: BuilderState<TData>,
  patch: Partial<BuilderState<TData>>,
): BuilderState<TData> {
  return Object.freeze({
    ...s,
    ...patch,
  });
}
