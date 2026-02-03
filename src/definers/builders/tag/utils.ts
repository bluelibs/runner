import type { BuilderState } from "./types";

/**
 * Clones and patches the builder state immutably.
 */
export function clone<TConfig, TEnforceIn, TEnforceOut, TNextConfig = TConfig>(
  s: BuilderState<TConfig, TEnforceIn, TEnforceOut>,
  patch: Partial<BuilderState<TNextConfig, TEnforceIn, TEnforceOut>>,
): BuilderState<TNextConfig, TEnforceIn, TEnforceOut> {
  return Object.freeze({
    ...(s as unknown as BuilderState<TNextConfig, TEnforceIn, TEnforceOut>),
    ...patch,
  });
}
