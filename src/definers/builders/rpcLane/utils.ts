import type { BuilderState } from "./types";

export function clone<T>(
  state: BuilderState<T>,
  patch: Partial<BuilderState<T>>,
): BuilderState<T> {
  return Object.freeze({
    ...state,
    ...patch,
  });
}
