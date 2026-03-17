import type {
  DependencyMapType,
  ResourceMiddlewareTagType,
  TaskMiddlewareTagType,
} from "../../../defs";
import type { TaskMwState, ResMwState } from "./types";

/**
 * Clones and patches the Task middleware state immutably.
 */
export function cloneTask<
  C,
  In,
  Out,
  D extends DependencyMapType,
  TTags extends TaskMiddlewareTagType[],
>(
  s: TaskMwState<C, In, Out, D, TTags>,
  patch: Partial<TaskMwState<C, In, Out, D, TTags>>,
): TaskMwState<C, In, Out, D, TTags>;
export function cloneTask<
  C,
  In,
  Out,
  D extends DependencyMapType,
  TTags extends TaskMiddlewareTagType[],
  TNextConfig,
  TNextIn,
  TNextOut,
  TNextDeps extends DependencyMapType,
  TNextTags extends TaskMiddlewareTagType[],
>(
  s: TaskMwState<C, In, Out, D, TTags>,
  patch: Partial<
    TaskMwState<TNextConfig, TNextIn, TNextOut, TNextDeps, TNextTags>
  >,
): TaskMwState<TNextConfig, TNextIn, TNextOut, TNextDeps, TNextTags>;
export function cloneTask<
  C,
  In,
  Out,
  D extends DependencyMapType,
  TTags extends TaskMiddlewareTagType[],
  TNextConfig = C,
  TNextIn = In,
  TNextOut = Out,
  TNextDeps extends DependencyMapType = D,
  TNextTags extends TaskMiddlewareTagType[] = TTags,
>(
  s: TaskMwState<C, In, Out, D, TTags>,
  patch: Partial<
    TaskMwState<TNextConfig, TNextIn, TNextOut, TNextDeps, TNextTags>
  >,
): TaskMwState<TNextConfig, TNextIn, TNextOut, TNextDeps, TNextTags> {
  const next = {
    ...s,
    ...patch,
  };
  return Object.freeze({
    ...next,
  }) as TaskMwState<TNextConfig, TNextIn, TNextOut, TNextDeps, TNextTags>;
}

/**
 * Clones and patches the Resource middleware state immutably.
 */
export function cloneRes<
  C,
  In,
  Out,
  D extends DependencyMapType,
  TTags extends ResourceMiddlewareTagType[],
>(
  s: ResMwState<C, In, Out, D, TTags>,
  patch: Partial<ResMwState<C, In, Out, D, TTags>>,
): ResMwState<C, In, Out, D, TTags>;
export function cloneRes<
  C,
  In,
  Out,
  D extends DependencyMapType,
  TTags extends ResourceMiddlewareTagType[],
  TNextConfig,
  TNextIn,
  TNextOut,
  TNextDeps extends DependencyMapType,
  TNextTags extends ResourceMiddlewareTagType[],
>(
  s: ResMwState<C, In, Out, D, TTags>,
  patch: Partial<
    ResMwState<TNextConfig, TNextIn, TNextOut, TNextDeps, TNextTags>
  >,
): ResMwState<TNextConfig, TNextIn, TNextOut, TNextDeps, TNextTags>;
export function cloneRes<
  C,
  In,
  Out,
  D extends DependencyMapType,
  TTags extends ResourceMiddlewareTagType[],
  TNextConfig = C,
  TNextIn = In,
  TNextOut = Out,
  TNextDeps extends DependencyMapType = D,
  TNextTags extends ResourceMiddlewareTagType[] = TTags,
>(
  s: ResMwState<C, In, Out, D, TTags>,
  patch: Partial<
    ResMwState<TNextConfig, TNextIn, TNextOut, TNextDeps, TNextTags>
  >,
): ResMwState<TNextConfig, TNextIn, TNextOut, TNextDeps, TNextTags> {
  const next = {
    ...s,
    ...patch,
  };
  return Object.freeze({
    ...next,
  }) as ResMwState<TNextConfig, TNextIn, TNextOut, TNextDeps, TNextTags>;
}

export { mergeArray } from "../shared/mergeUtils";
export { mergeDepsWithConfig as mergeDependencies } from "../shared/mergeUtils";
