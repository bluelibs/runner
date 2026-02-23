import type {
  DependencyMapType,
  IHook,
  OnType,
  IResource,
  IResourceMeta,
  IResourceMiddleware,
  ResourceTagType,
  ITask,
  ITaskMeta,
  ITaskMiddleware,
  TaskTagType,
  ResourceMiddlewareAttachmentType,
  TaskMiddlewareAttachmentType,
} from "../../../defs";
import {
  isHook,
  isResource,
  isResourceMiddleware,
  isTask,
  isTaskMiddleware,
} from "../../tools";
import { defineOverride } from "../../defineOverride";
import { overrideUnsupportedBaseError } from "../../../errors";

const overrideUnsupportedBaseMessage =
  "r.override() supports tasks, resources, hooks, and middleware only.";
const overrideMissingImplementationMessage =
  "r.override() requires an implementation function as the second argument.";
const overrideInvalidImplementationMessage =
  "r.override() second argument must be a function (task/hook/middleware run or resource init).";

type OverrideBuilderBase =
  | ITask<any, any, any, any, any, any>
  | IResource<any, any, any, any, any, any, any>
  | IHook<any, any, any>
  | ITaskMiddleware<any, any, any, any>
  | IResourceMiddleware<any, any, any, any>;

export function override<
  TInput,
  TOutput extends Promise<any>,
  TDeps extends DependencyMapType,
  TMeta extends ITaskMeta,
  TTags extends TaskTagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[],
>(
  base: ITask<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>,
  run: ITask<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>["run"],
): ITask<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>;
export function override<
  TConfig,
  TValue extends Promise<any>,
  TDeps extends DependencyMapType,
  TContext,
  TMeta extends IResourceMeta,
  TTags extends ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[],
>(
  base: IResource<TConfig, TValue, TDeps, TContext, TMeta, TTags, TMiddleware>,
  init: NonNullable<
    IResource<
      TConfig,
      TValue,
      TDeps,
      TContext,
      TMeta,
      TTags,
      TMiddleware
    >["init"]
  >,
): IResource<TConfig, TValue, TDeps, TContext, TMeta, TTags, TMiddleware>;
export function override<
  TDeps extends DependencyMapType,
  TOn extends OnType,
  TMeta extends ITaskMeta,
>(
  base: IHook<TDeps, TOn, TMeta>,
  run: IHook<TDeps, TOn, TMeta>["run"],
): IHook<TDeps, TOn, TMeta>;
export function override<C, In, Out, D extends DependencyMapType>(
  base: ITaskMiddleware<C, In, Out, D>,
  run: ITaskMiddleware<C, In, Out, D>["run"],
): ITaskMiddleware<C, In, Out, D>;
export function override<C, In, Out, D extends DependencyMapType>(
  base: IResourceMiddleware<C, In, Out, D>,
  run: IResourceMiddleware<C, In, Out, D>["run"],
): IResourceMiddleware<C, In, Out, D>;
export function override(base: OverrideBuilderBase, fn?: unknown) {
  if (fn === undefined) {
    overrideUnsupportedBaseError.throw({
      message: overrideMissingImplementationMessage,
    });
  }
  if (typeof fn !== "function") {
    overrideUnsupportedBaseError.throw({
      message: overrideInvalidImplementationMessage,
    });
  }

  if (isTask(base)) {
    return defineOverride(base, {
      run: fn as typeof base.run,
    });
  }
  if (isResource(base)) {
    return defineOverride(base, {
      init: fn as NonNullable<typeof base.init>,
    });
  }
  if (isHook(base)) {
    return defineOverride(base, {
      run: fn as typeof base.run,
    });
  }
  if (isTaskMiddleware(base)) {
    return defineOverride(base, {
      run: fn as typeof base.run,
    });
  }
  if (isResourceMiddleware(base)) {
    return defineOverride(base, {
      run: fn as typeof base.run,
    });
  }
  overrideUnsupportedBaseError.throw({
    message: overrideUnsupportedBaseMessage,
  });
}
