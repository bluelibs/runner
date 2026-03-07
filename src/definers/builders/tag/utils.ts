import type { BuilderState } from "./types";
import type { TagTarget } from "../../../defs";

/**
 * Clones and patches the builder state immutably.
 */
export function clone<
  TConfig,
  TEnforceIn,
  TEnforceOut,
  TTargets extends TagTarget | void,
  TNextConfig = TConfig,
  TNextTargets extends TagTarget | void = TTargets,
>(
  s: BuilderState<TConfig, TEnforceIn, TEnforceOut, TTargets>,
  patch: Partial<
    BuilderState<TNextConfig, TEnforceIn, TEnforceOut, TNextTargets>
  >,
): BuilderState<TNextConfig, TEnforceIn, TEnforceOut, TNextTargets> {
  return Object.freeze({
    ...(s as BuilderState<TNextConfig, TEnforceIn, TEnforceOut, TNextTargets>),
    ...patch,
  });
}

export { mergeArray } from "../shared/mergeUtils";
