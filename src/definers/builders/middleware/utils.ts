import type { DependencyMapType } from "../../../defs";
import type { TaskMwState, ResMwState } from "./types";

/**
 * Clones and patches the Task middleware state immutably.
 */
export function cloneTask<C, In, Out, D extends DependencyMapType>(
  s: TaskMwState<C, In, Out, D>,
  patch: Partial<TaskMwState<C, In, Out, D>>,
): TaskMwState<C, In, Out, D>;
export function cloneTask<
  C,
  In,
  Out,
  D extends DependencyMapType,
  TNextConfig,
  TNextIn,
  TNextOut,
  TNextDeps extends DependencyMapType,
>(
  s: TaskMwState<C, In, Out, D>,
  patch: Partial<TaskMwState<TNextConfig, TNextIn, TNextOut, TNextDeps>>,
): TaskMwState<TNextConfig, TNextIn, TNextOut, TNextDeps>;
export function cloneTask<
  C,
  In,
  Out,
  D extends DependencyMapType,
  TNextConfig = C,
  TNextIn = In,
  TNextOut = Out,
  TNextDeps extends DependencyMapType = D,
>(
  s: TaskMwState<C, In, Out, D>,
  patch: Partial<TaskMwState<TNextConfig, TNextIn, TNextOut, TNextDeps>>,
): TaskMwState<TNextConfig, TNextIn, TNextOut, TNextDeps> {
  const next = {
    ...s,
    ...patch,
  };
  return Object.freeze({
    ...next,
  }) as TaskMwState<TNextConfig, TNextIn, TNextOut, TNextDeps>;
}

/**
 * Clones and patches the Resource middleware state immutably.
 */
export function cloneRes<C, In, Out, D extends DependencyMapType>(
  s: ResMwState<C, In, Out, D>,
  patch: Partial<ResMwState<C, In, Out, D>>,
): ResMwState<C, In, Out, D>;
export function cloneRes<
  C,
  In,
  Out,
  D extends DependencyMapType,
  TNextConfig,
  TNextIn,
  TNextOut,
  TNextDeps extends DependencyMapType,
>(
  s: ResMwState<C, In, Out, D>,
  patch: Partial<ResMwState<TNextConfig, TNextIn, TNextOut, TNextDeps>>,
): ResMwState<TNextConfig, TNextIn, TNextOut, TNextDeps>;
export function cloneRes<
  C,
  In,
  Out,
  D extends DependencyMapType,
  TNextConfig = C,
  TNextIn = In,
  TNextOut = Out,
  TNextDeps extends DependencyMapType = D,
>(
  s: ResMwState<C, In, Out, D>,
  patch: Partial<ResMwState<TNextConfig, TNextIn, TNextOut, TNextDeps>>,
): ResMwState<TNextConfig, TNextIn, TNextOut, TNextDeps> {
  const next = {
    ...s,
    ...patch,
  };
  return Object.freeze({
    ...next,
  }) as ResMwState<TNextConfig, TNextIn, TNextOut, TNextDeps>;
}

export { mergeArray } from "../shared/mergeUtils";

/**
 * Merges dependencies handling all combinations of objects and functions.
 */
export function mergeDependencies<
  C,
  TExisting extends DependencyMapType,
  TNew extends DependencyMapType,
>(
  existing: TExisting | ((config: C) => TExisting) | undefined,
  addition: TNew | ((config: C) => TNew),
  override: boolean,
): (TExisting & TNew) | ((config: C) => TExisting & TNew) {
  const isFnExisting = typeof existing === "function";
  const isFnAddition = typeof addition === "function";

  type Result = (TExisting & TNew) | ((config: C) => TExisting & TNew);

  if (override || !existing) {
    return addition as Result;
  }

  if (isFnExisting && isFnAddition) {
    const e = existing as (config: C) => TExisting;
    const a = addition as (config: C) => TNew;
    return ((config: C) => ({
      ...e(config),
      ...a(config),
    })) as Result;
  }
  if (isFnExisting && !isFnAddition) {
    const e = existing as (config: C) => TExisting;
    const a = addition as TNew;
    return ((config: C) => ({
      ...e(config),
      ...a,
    })) as Result;
  }
  if (!isFnExisting && isFnAddition) {
    const e = existing as TExisting;
    const a = addition as (config: C) => TNew;
    return ((config: C) => ({
      ...e,
      ...a(config),
    })) as Result;
  }
  const e = existing as TExisting;
  const a = addition as TNew;
  return { ...e, ...a } as Result;
}
