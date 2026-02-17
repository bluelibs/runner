import type {
  DependencyMapType,
  IHook,
  IResource,
  IResourceMeta,
  IResourceMiddleware,
  ITask,
  ITaskMeta,
  ITaskMiddleware,
  ResourceMiddlewareAttachmentType,
  TagType,
  TaskMiddlewareAttachmentType,
} from "../../../defs";
import {
  isHook,
  isResource,
  isResourceMiddleware,
  isTask,
  isTaskMiddleware,
} from "../../tools";
import type { ResourceFluentBuilder } from "../resource/fluent-builder.interface";
import type { TaskFluentBuilder } from "../task/fluent-builder.interface";
import type { ResourceMiddlewareFluentBuilder } from "../middleware/resource.interface";
import type { TaskMiddlewareFluentBuilder } from "../middleware/task.interface";
import type { HookOn, HookOverrideBuilder } from "./hook";
import { hookOverrideBuilder } from "./hook";
import { resourceOverrideBuilder } from "./resource";
import { resourceMiddlewareOverrideBuilder } from "./resource-middleware";
import { taskOverrideBuilder } from "./task";
import { taskMiddlewareOverrideBuilder } from "./task-middleware";
import { overrideUnsupportedBaseError } from "../../../errors";

enum OverrideBuilderErrorMessage {
  UnsupportedBase = "r.override() supports tasks, resources, hooks, and middleware only.",
}

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
  TTags extends TagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[],
>(
  base: ITask<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>,
): TaskFluentBuilder<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>;
export function override<
  TConfig,
  TValue extends Promise<any>,
  TDeps extends DependencyMapType,
  TContext,
  TMeta extends IResourceMeta,
  TTags extends TagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[],
>(
  base: IResource<TConfig, TValue, TDeps, TContext, TMeta, TTags, TMiddleware>,
): ResourceFluentBuilder<
  TConfig,
  TValue,
  TDeps,
  TContext,
  TMeta,
  TTags,
  TMiddleware
>;
export function override<
  TDeps extends DependencyMapType,
  TOn extends HookOn,
  TMeta extends ITaskMeta,
>(base: IHook<TDeps, TOn, TMeta>): HookOverrideBuilder<TDeps, TOn, TMeta>;
export function override<C, In, Out, D extends DependencyMapType>(
  base: ITaskMiddleware<C, In, Out, D>,
): TaskMiddlewareFluentBuilder<C, In, Out, D>;
export function override<C, In, Out, D extends DependencyMapType>(
  base: IResourceMiddleware<C, In, Out, D>,
): ResourceMiddlewareFluentBuilder<C, In, Out, D>;
export function override(base: OverrideBuilderBase) {
  if (isTask(base)) {
    return taskOverrideBuilder(base);
  }
  if (isResource(base)) {
    return resourceOverrideBuilder(base);
  }
  if (isHook(base)) {
    return hookOverrideBuilder(base);
  }
  if (isTaskMiddleware(base)) {
    return taskMiddlewareOverrideBuilder(base);
  }
  if (isResourceMiddleware(base)) {
    return resourceMiddlewareOverrideBuilder(base);
  }
  overrideUnsupportedBaseError.throw({
    message: OverrideBuilderErrorMessage.UnsupportedBase,
  });
}
