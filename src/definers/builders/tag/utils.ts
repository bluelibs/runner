import type { BuilderState } from "./types";

/**
 * Clones and patches the builder state immutably.
 */
export function clone<TConfig, TEnforceIn, TEnforceOut>(
  s: BuilderState<TConfig, TEnforceIn, TEnforceOut>,
  patch: Partial<BuilderState<TConfig, TEnforceIn, TEnforceOut>>,
): BuilderState<TConfig, TEnforceIn, TEnforceOut> {
  return Object.freeze({
    ...s,
    ...patch,
  });
}
