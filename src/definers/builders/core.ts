import type {
  DependencyMapType,
  IEventDefinition,
  IResourceDefinition,
  ITaskDefinition,
  IHookDefinition,
  ITaskMiddlewareDefinition,
  IResourceMiddlewareDefinition,
  TagType,
  ResourceMiddlewareAttachmentType,
  TaskMiddlewareAttachmentType,
} from "../../defs";
import type { IResourceMeta, ITaskMeta } from "../../defs";

// The core builder infrastructure is intentionally lightweight and immutable.
// Each chain call creates a new builder instance carrying a refined definition
// snapshot. Finalization delegates to the existing define* APIs for parity.

export type Immutable<T> = {
  readonly [K in keyof T]: Immutable<T[K]>;
};

export type ReadonlyDeep<T> = Immutable<T>;

export interface ResourceBuilder<
  TConfig = void,
  TValue extends Promise<any> = Promise<any>,
  TDeps extends DependencyMapType = {},
  TContext = any,
  TMeta extends IResourceMeta = any,
  TTags extends TagType[] = TagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[] =
    ResourceMiddlewareAttachmentType[],
> {
  id: string;
  definition: ReadonlyDeep<
    IResourceDefinition<
      TConfig,
      TValue,
      TDeps,
      TContext,
      any,
      any,
      TMeta,
      TTags,
      TMiddleware
    >
  >;
}

export interface TaskBuilder<
  TInput = undefined,
  TOutput extends Promise<any> = any,
  TDeps extends DependencyMapType = {},
  TMeta extends ITaskMeta = any,
  TTags extends TagType[] = TagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[] =
    TaskMiddlewareAttachmentType[],
> {
  id: string;
  definition: ReadonlyDeep<
    ITaskDefinition<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>
  >;
}

export interface EventBuilder<TPayload = void> {
  id: string;
  definition: ReadonlyDeep<IEventDefinition<TPayload>>;
}

export interface HookBuilder<
  TDeps extends DependencyMapType = {},
  TOn extends "*" | IEventDefinition<any> | readonly IEventDefinition<any>[] =
    any,
  TMeta extends ITaskMeta = any,
> {
  id: string;
  definition: ReadonlyDeep<IHookDefinition<TDeps, TOn, TMeta>>;
}

export interface TaskMiddlewareBuilder<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
> {
  id: string;
  definition: ReadonlyDeep<
    ITaskMiddlewareDefinition<
      TConfig,
      TEnforceInputContract,
      TEnforceOutputContract,
      TDependencies
    >
  >;
}

export interface ResourceMiddlewareBuilder<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
> {
  id: string;
  definition: ReadonlyDeep<
    IResourceMiddlewareDefinition<
      TConfig,
      TEnforceInputContract,
      TEnforceOutputContract,
      TDependencies
    >
  >;
}
