import type {
  DependencyMapType,
  IEventDefinition,
  ITaskMeta,
} from "../../../defs";
import type { BuilderState } from "./types";

/**
 * Clones and patches the builder state immutably.
 */
export function clone<
  TDeps extends DependencyMapType,
  TOn extends
    | "*"
    | IEventDefinition<any>
    | readonly IEventDefinition<any>[]
    | undefined,
  TMeta extends ITaskMeta,
  TNextDeps extends DependencyMapType = TDeps,
  TNextOn extends
    | "*"
    | IEventDefinition<any>
    | readonly IEventDefinition<any>[]
    | undefined = TOn,
  TNextMeta extends ITaskMeta = TMeta,
>(
  s: BuilderState<TDeps, TOn, TMeta>,
  patch: Partial<BuilderState<TNextDeps, TNextOn, TNextMeta>>,
): BuilderState<TNextDeps, TNextOn, TNextMeta> {
  type NextState = BuilderState<TNextDeps, TNextOn, TNextMeta>;
  return Object.freeze({
    ...(s as unknown as NextState),
    ...patch,
  }) as NextState;
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
  TExisting extends DependencyMapType,
  TNew extends DependencyMapType,
>(
  existing: TExisting | (() => TExisting) | undefined,
  addition: TNew | (() => TNew),
  override: boolean,
): (TExisting & TNew) | (() => TExisting & TNew) {
  const isFnExisting = typeof existing === "function";
  const isFnAddition = typeof addition === "function";

  type Result = (TExisting & TNew) | (() => TExisting & TNew);

  if (override || !existing) {
    return addition as unknown as Result;
  }

  if (isFnExisting && isFnAddition) {
    const e = existing as () => TExisting;
    const a = addition as () => TNew;
    return (() => ({
      ...e(),
      ...a(),
    })) as Result;
  }
  if (isFnExisting && !isFnAddition) {
    const e = existing as () => TExisting;
    const a = addition as TNew;
    return (() => ({
      ...e(),
      ...a,
    })) as Result;
  }
  if (!isFnExisting && isFnAddition) {
    const e = existing as TExisting;
    const a = addition as () => TNew;
    return (() => ({
      ...e,
      ...a(),
    })) as Result;
  }
  const e = existing as TExisting;
  const a = addition as TNew;
  return { ...e, ...a } as Result;
}
