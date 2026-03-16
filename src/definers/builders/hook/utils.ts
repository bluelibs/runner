import type { DependencyMapType, ITaskMeta, OnType } from "../../../defs";
import type { BuilderState } from "./types";

/**
 * Clones and patches the builder state immutably.
 */
export function clone<
  TDeps extends DependencyMapType,
  TOn extends OnType | undefined,
  TMeta extends ITaskMeta,
  TNextDeps extends DependencyMapType = TDeps,
  TNextOn extends OnType | undefined = TOn,
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
