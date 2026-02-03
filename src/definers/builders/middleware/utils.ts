import type { DependencyMapType } from "../../../defs";
import type { TaskMwState, ResMwState } from "./types";

/**
 * Clones and patches the Task middleware state immutably.
 */
export function cloneTask<C, In, Out, D extends DependencyMapType>(
  s: TaskMwState<C, In, Out, D>,
  patch: Partial<TaskMwState<C, In, Out, D>>,
): TaskMwState<C, In, Out, D> {
  return Object.freeze({
    ...s,
    ...patch,
  });
}

/**
 * Clones and patches the Resource middleware state immutably.
 */
export function cloneRes<C, In, Out, D extends DependencyMapType>(
  s: ResMwState<C, In, Out, D>,
  patch: Partial<ResMwState<C, In, Out, D>>,
): ResMwState<C, In, Out, D> {
  return Object.freeze({
    ...s,
    ...patch,
  });
}

/**
 * Generic array merge with override support.
 */
export function mergeArray<T>(
  existing: ReadonlyArray<T> | undefined,
  addition: ReadonlyArray<T>,
  override: boolean,
): T[] {
  const toArray = [...addition];
  if (override || !existing) {
    return toArray;
  }
  return [...existing, ...toArray];
}

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
    return addition as unknown as Result;
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
