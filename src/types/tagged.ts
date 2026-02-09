import type {
  HasInputContracts,
  HasOutputContracts,
  InferInputOrViolationFromContracts,
  InferOutputOrViolationFromContracts,
} from "./contracts";
import type { IResource } from "./resource";
import type { ITask } from "./task";
import type { ITag } from "./tag";

type TagInputContract<TTag extends ITag<any, any, any>> =
  HasInputContracts<[TTag]> extends true
    ? InferInputOrViolationFromContracts<[TTag]>
    : any;

type TagOutputContract<TTag extends ITag<any, any, any>> =
  HasOutputContracts<[TTag]> extends true
    ? InferOutputOrViolationFromContracts<[TTag]>
    : any;

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
