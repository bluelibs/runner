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
  const next = {
    ...s,
    ...patch,
  };
  return Object.freeze({
    ...next,
  }) as NextState;
}

export { mergeArray } from "../shared/mergeUtils";

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
    return addition as Result;
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
