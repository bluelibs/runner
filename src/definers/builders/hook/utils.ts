import type { DependencyMapType, ITaskMeta } from "../../../defs";
import type { BuilderState } from "./types";
import type { ValidOnTarget } from "./fluent-builder.interface";

/**
 * Clones and patches the builder state immutably.
 */
export function clone<
  TDeps extends DependencyMapType,
  TOn extends ValidOnTarget | undefined,
  TMeta extends ITaskMeta,
  TNextDeps extends DependencyMapType = TDeps,
  TNextOn extends ValidOnTarget | undefined = TOn,
  TNextMeta extends ITaskMeta = TMeta,
>(
  s: BuilderState<TDeps, TOn, TMeta>,
  patch: Partial<BuilderState<TNextDeps, TNextOn, TNextMeta>>,
): BuilderState<TNextDeps, TNextOn, TNextMeta> {
  type NextState = BuilderState<TNextDeps, TNextOn, TNextMeta>;
  const next = {
    ...s,
    ...patch,
  };
  return Object.freeze({
    ...next,
  }) as NextState;
}

export { mergeArray } from "../shared/mergeUtils";
export { mergeDepsNoConfig as mergeDependencies } from "../shared/mergeUtils";
