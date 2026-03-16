import {
  DependencyMapType,
  IHook,
  IResource,
  IResourceMeta,
  IResourceMiddleware,
  ResourceDependencyValuesType,
  ITask,
  ITaskMeta,
  ITaskMiddleware,
  OnType,
  OverrideDefinitionBrand,
  ResourceMiddlewareAttachmentType,
  ResourceTagType,
  TaskMiddlewareAttachmentType,
  TaskTagType,
  symbolOverrideDefinition,
  symbolOverrideTargetDefinition,
} from "../defs";
import {
  isHook,
  isResource,
  isResourceMiddleware,
  isTask,
  isTaskMiddleware,
} from "./tools";
import { freezeIfLineageLocked } from "../tools/deepFreeze";
import { overrideUnsupportedBaseError } from "../errors";
import {
  normalizeResourceOverridePatch,
  ResourceOverridePatch,
} from "./resourceOverridePatch";

const overrideUnsupportedBaseMessage =
  "r.override() / defineOverride() supports tasks, resources, hooks, and middleware only.";
const overrideMissingImplementationMessage =
  "r.override() / defineOverride() requires an implementation function as the second argument.";
const overrideInvalidImplementationMessage =
  "r.override() / defineOverride() second argument must be a function (task/hook/middleware run or resource init).";
const overrideInvalidNonResourcePatchMessage =
  "r.override() / defineOverride() resource patch objects are supported only when the base is a resource.";

type OverrideBuilderBase =
  | ITask<any, any, any, any, any, any>
  | IResource<any, any, any, any, any, any, any>
  | IHook<any, any, any>
  | ITaskMiddleware<any, any, any, any>
  | IResourceMiddleware<any, any, any, any>;

const isObjectLike = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function brandOverride<TBase extends object, TDefinition extends object>(
  base: TBase,
  definition: TDefinition,
): TDefinition & OverrideDefinitionBrand {
  const branded = {
    ...(definition as object),
    [symbolOverrideDefinition]: true,
    [symbolOverrideTargetDefinition]: base,
  } as unknown as TDefinition & OverrideDefinitionBrand;
  return freezeIfLineageLocked(base, branded);
}

type OverridePatch<TBase> = Readonly<
  TBase extends IHook<any, any, any>
    ? Omit<Partial<TBase>, "id" | "on">
    : Omit<Partial<TBase>, "id">
>;

function applyOverridePatch<TBase extends OverrideBuilderBase>(
  base: TBase,
  patch: OverridePatch<TBase>,
): TBase & OverrideDefinitionBrand {
  const overridden = {
    ...base,
    ...patch,
    id: base.id,
  } as TBase;

  // Hooks preserve `on`; overrides are behavior-only for listeners.
  if ("on" in base && base.on !== undefined) {
    (overridden as IHook<any, any, any>).on = (base as IHook<any, any, any>).on;
  }

  return brandOverride(base, overridden);
}

/**
 * Overrides a task, resource, hook, or middleware definition without mutating the original.
 *
 * Use this to adapt shared definitions in a local composition tree while preserving
 * identity and ancestry information for Runner internals.
 */
export function defineOverride<
  TInput,
  TOutput extends Promise<any>,
  TDeps extends DependencyMapType,
  TMeta extends ITaskMeta,
  TTags extends TaskTagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[],
>(
  base: ITask<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>,
  run: ITask<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>["run"],
): ITask<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware> &
  OverrideDefinitionBrand;
export function defineOverride<
  TConfig,
  TResolved,
  TDeps extends DependencyMapType,
  TContext,
  TMeta extends IResourceMeta,
  TTags extends ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[],
>(
  base: IResource<
    TConfig,
    Promise<TResolved>,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >,
  init: (
    config: TConfig,
    dependencies: ResourceDependencyValuesType<TDeps>,
    context: TContext,
  ) => Promise<TResolved>,
): IResource<
  TConfig,
  Promise<TResolved>,
  TDeps,
  TContext,
  TMeta,
  TTags,
  TMiddleware
> &
  OverrideDefinitionBrand;
export function defineOverride<
  TConfig,
  TValue extends Promise<any>,
  TDeps extends DependencyMapType,
  TContext,
  TMeta extends IResourceMeta,
  TTags extends ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[],
>(
  base: IResource<TConfig, TValue, TDeps, TContext, TMeta, TTags, TMiddleware>,
  patch: ResourceOverridePatch<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >,
): IResource<TConfig, TValue, TDeps, TContext, TMeta, TTags, TMiddleware> &
  OverrideDefinitionBrand;
export function defineOverride<
  TDeps extends DependencyMapType,
  TOn extends OnType,
  TMeta extends ITaskMeta,
>(
  base: IHook<TDeps, TOn, TMeta>,
  run: IHook<TDeps, TOn, TMeta>["run"],
): IHook<TDeps, TOn, TMeta> & OverrideDefinitionBrand;
export function defineOverride<C, In, Out, D extends DependencyMapType>(
  base: ITaskMiddleware<C, In, Out, D>,
  run: ITaskMiddleware<C, In, Out, D>["run"],
): ITaskMiddleware<C, In, Out, D> & OverrideDefinitionBrand;
export function defineOverride<C, In, Out, D extends DependencyMapType>(
  base: IResourceMiddleware<C, In, Out, D>,
  run: IResourceMiddleware<C, In, Out, D>["run"],
): IResourceMiddleware<C, In, Out, D> & OverrideDefinitionBrand;

export function defineOverride(
  base: OverrideBuilderBase,
  implementation?: unknown,
) {
  if (implementation === undefined) {
    overrideUnsupportedBaseError.throw({
      message: overrideMissingImplementationMessage,
    });
  }

  if (isResource(base)) {
    if (typeof implementation === "function") {
      return applyOverridePatch(base, {
        init: implementation as NonNullable<typeof base.init>,
      });
    }

    if (!isObjectLike(implementation)) {
      overrideUnsupportedBaseError.throw({
        message: overrideInvalidImplementationMessage,
      });
    }

    const patch = normalizeResourceOverridePatch(
      base,
      implementation as Record<string, unknown>,
    );
    return applyOverridePatch(base, patch);
  }

  if (isObjectLike(implementation)) {
    overrideUnsupportedBaseError.throw({
      message: overrideInvalidNonResourcePatchMessage,
    });
  }
  if (typeof implementation !== "function") {
    overrideUnsupportedBaseError.throw({
      message: overrideInvalidImplementationMessage,
    });
  }

  if (isTask(base)) {
    return applyOverridePatch(base, {
      run: implementation as typeof base.run,
    });
  }
  if (isHook(base)) {
    return applyOverridePatch(base, {
      run: implementation as typeof base.run,
    });
  }
  if (isTaskMiddleware(base)) {
    return applyOverridePatch(base, {
      run: implementation as typeof base.run,
    });
  }
  if (isResourceMiddleware(base)) {
    return applyOverridePatch(base, {
      run: implementation as typeof base.run,
    });
  }
  overrideUnsupportedBaseError.throw({
    message: overrideUnsupportedBaseMessage,
  });
}
