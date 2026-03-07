import type { IResource } from "./resource";
import type { ResourceMiddlewareAttachmentType } from "./resourceMiddleware";
import type { IEvent } from "./event";
import type { IHook } from "./hook";
import type { ITag } from "./tag";
import type { ITask } from "./task";
import type { IResourceMiddleware } from "./resourceMiddleware";
import type { ITaskMiddleware } from "./taskMiddleware";
import type { TaskMiddlewareAttachmentType } from "./taskMiddleware";

export type SubtreeViolationCode = string;

export type SubtreeViolation = {
  code: SubtreeViolationCode;
  message: string;
};

export type SubtreeValidatableElement =
  | ITask<any, any, any, any, any, any>
  | IResource<any, any, any, any, any, any, any>
  | IHook<any, any, any>
  | ITaskMiddleware<any, any, any, any>
  | IResourceMiddleware<any, any, any, any>
  | IEvent<any>
  | ITag<any, any, any, any>;

export type SubtreeElementValidator = (
  element: SubtreeValidatableElement,
  ownerResourceConfig: unknown,
) => SubtreeViolation[];

export type SubtreeTaskMiddlewarePredicate = (
  taskDefinition: ITask<any, any, any, any, any, any>,
) => boolean;

export type SubtreeResourceMiddlewarePredicate = (
  resourceDefinition: IResource<any, any, any, any, any, any, any>,
) => boolean;

export type SubtreeTaskMiddlewareEntry =
  | TaskMiddlewareAttachmentType
  | {
      use: TaskMiddlewareAttachmentType;
      when?: SubtreeTaskMiddlewarePredicate;
    };

export type SubtreeResourceMiddlewareEntry =
  | ResourceMiddlewareAttachmentType
  | {
      use: ResourceMiddlewareAttachmentType;
      when?: SubtreeResourceMiddlewarePredicate;
    };

export type ResourceSubtreeTaskPolicy = {
  middleware?: SubtreeTaskMiddlewareEntry[];
};

export type ResourceSubtreeResourcePolicy = {
  middleware?: SubtreeResourceMiddlewareEntry[];
};

export type ResourceSubtreePolicy = {
  tasks?: ResourceSubtreeTaskPolicy;
  resources?: ResourceSubtreeResourcePolicy;
  validate?: SubtreeElementValidator | SubtreeElementValidator[];
};

export type NormalizedResourceSubtreeTaskPolicy = {
  middleware: SubtreeTaskMiddlewareEntry[];
};

export type NormalizedResourceSubtreeResourcePolicy = {
  middleware: SubtreeResourceMiddlewareEntry[];
};

export type NormalizedResourceSubtreePolicy = {
  tasks?: NormalizedResourceSubtreeTaskPolicy;
  resources?: NormalizedResourceSubtreeResourcePolicy;
  validate?: SubtreeElementValidator[];
};

export type SubtreePolicyOptions = {
  override?: boolean;
};

export type SubtreeValidationTargetType =
  | "task"
  | "resource"
  | "hook"
  | "task-middleware"
  | "resource-middleware"
  | "event"
  | "tag";

export type SubtreePolicyViolationRecord = {
  ownerResourceId: string;
  targetType: SubtreeValidationTargetType;
  targetId: string;
  violation: SubtreeViolation;
};
