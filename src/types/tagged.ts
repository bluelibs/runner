import type {
  HasInputContracts,
  HasOutputContracts,
  InferInputOrViolationFromContracts,
  InferOutputOrViolationFromContracts,
} from "./contracts";
import type { IEvent } from "./event";
import type { IHook } from "./hook";
import type { IErrorHelper } from "./error";
import type { IResource } from "./resource";
import type { IResourceMiddleware } from "./resourceMiddleware";
import type { ITask } from "./task";
import type { ITaskMiddleware } from "./taskMiddleware";
import type { ITag } from "./tag";

type TagInputContract<TTag extends ITag<any, any, any>> =
  HasInputContracts<[TTag]> extends true
    ? InferInputOrViolationFromContracts<[TTag]>
    : unknown;

type TagOutputContract<TTag extends ITag<any, any, any>> =
  HasOutputContracts<[TTag]> extends true
    ? InferOutputOrViolationFromContracts<[TTag]>
    : unknown;

export type AnyResource = IResource<any, any, any, any, any, any, any>;

/**
 * A task discovered by a concrete tag. If the tag carries contracts,
 * its input/output contracts are reflected in the task signature.
 */
export type TaggedTask<TTag extends ITag<any, any, any>> = ITask<
  TagInputContract<TTag>,
  Promise<TagOutputContract<TTag>>,
  any,
  any,
  any,
  any
>;

/**
 * A resource discovered by a concrete tag. If the tag carries contracts,
 * its config/value contracts are reflected in the resource signature.
 */
export type TaggedResource<TTag extends ITag<any, any, any>> = IResource<
  TagInputContract<TTag>,
  Promise<TagOutputContract<TTag>>,
  any,
  any,
  any,
  any,
  any
>;

type TagConfig<TTag extends ITag<any, any, any>> =
  TTag extends ITag<infer TConfig, any, any> ? TConfig : never;

export interface TagDependencyMatch<
  TDefinition,
  TTag extends ITag<any, any, any>,
> {
  definition: TDefinition;
  config: TagConfig<TTag> | undefined;
}

export interface TagDependencyAccessor<TTag extends ITag<any, any, any>> {
  tasks: ReadonlyArray<TagDependencyMatch<TaggedTask<TTag>, TTag>>;
  resources: ReadonlyArray<TagDependencyMatch<TaggedResource<TTag>, TTag>>;
  events: ReadonlyArray<TagDependencyMatch<IEvent<any>, TTag>>;
  hooks: ReadonlyArray<TagDependencyMatch<IHook<any, any, any>, TTag>>;
  taskMiddlewares: ReadonlyArray<
    TagDependencyMatch<ITaskMiddleware<any, any, any, any>, TTag>
  >;
  resourceMiddlewares: ReadonlyArray<
    TagDependencyMatch<IResourceMiddleware<any, any, any, any>, TTag>
  >;
  errors: ReadonlyArray<TagDependencyMatch<IErrorHelper<any>, TTag>>;
}
