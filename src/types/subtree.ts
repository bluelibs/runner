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
) => SubtreeViolation[];

export type SubtreeTaskValidator = (
  taskDefinition: ITask<any, any, any, any, any, any>,
) => SubtreeViolation[];

export type SubtreeResourceValidator = (
  resourceDefinition: IResource<any, any, any, any, any, any, any>,
) => SubtreeViolation[];

export type SubtreeHookValidator = (
  hookDefinition: IHook<any, any, any>,
) => SubtreeViolation[];

export type SubtreeEventValidator = (
  eventDefinition: IEvent<any>,
) => SubtreeViolation[];

export type SubtreeTagValidator = (
  tagDefinition: ITag<any, any, any, any>,
) => SubtreeViolation[];

export type SubtreeTaskMiddlewareValidator = (
  middlewareDefinition: ITaskMiddleware<any, any, any, any>,
) => SubtreeViolation[];

export type SubtreeResourceMiddlewareValidator = (
  middlewareDefinition: IResourceMiddleware<any, any, any, any>,
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
  validate?: SubtreeTaskValidator | SubtreeTaskValidator[];
};

export type ResourceSubtreeResourcePolicy = {
  middleware?: SubtreeResourceMiddlewareEntry[];
  validate?: SubtreeResourceValidator | SubtreeResourceValidator[];
};

export type ResourceSubtreeHookPolicy = {
  validate?: SubtreeHookValidator | SubtreeHookValidator[];
};

export type ResourceSubtreeEventPolicy = {
  validate?: SubtreeEventValidator | SubtreeEventValidator[];
};

export type ResourceSubtreeTagPolicy = {
  validate?: SubtreeTagValidator | SubtreeTagValidator[];
};

export type ResourceSubtreeTaskMiddlewarePolicy = {
  validate?: SubtreeTaskMiddlewareValidator | SubtreeTaskMiddlewareValidator[];
};

export type ResourceSubtreeResourceMiddlewarePolicy = {
  validate?:
    | SubtreeResourceMiddlewareValidator
    | SubtreeResourceMiddlewareValidator[];
};

export type ResourceSubtreePolicy = {
  tasks?: ResourceSubtreeTaskPolicy;
  resources?: ResourceSubtreeResourcePolicy;
  hooks?: ResourceSubtreeHookPolicy;
  events?: ResourceSubtreeEventPolicy;
  tags?: ResourceSubtreeTagPolicy;
  taskMiddleware?: ResourceSubtreeTaskMiddlewarePolicy;
  resourceMiddleware?: ResourceSubtreeResourceMiddlewarePolicy;
  validate?: SubtreeElementValidator | SubtreeElementValidator[];
};

export type NormalizedResourceSubtreeTaskPolicy = {
  middleware: SubtreeTaskMiddlewareEntry[];
  validate?: SubtreeTaskValidator[];
};

export type NormalizedResourceSubtreeResourcePolicy = {
  middleware: SubtreeResourceMiddlewareEntry[];
  validate?: SubtreeResourceValidator[];
};

export type NormalizedResourceSubtreeHookPolicy = {
  validate?: SubtreeHookValidator[];
};

export type NormalizedResourceSubtreeEventPolicy = {
  validate?: SubtreeEventValidator[];
};

export type NormalizedResourceSubtreeTagPolicy = {
  validate?: SubtreeTagValidator[];
};

export type NormalizedResourceSubtreeTaskMiddlewarePolicy = {
  validate?: SubtreeTaskMiddlewareValidator[];
};

export type NormalizedResourceSubtreeResourceMiddlewarePolicy = {
  validate?: SubtreeResourceMiddlewareValidator[];
};

export type NormalizedResourceSubtreePolicy = {
  tasks?: NormalizedResourceSubtreeTaskPolicy;
  resources?: NormalizedResourceSubtreeResourcePolicy;
  hooks?: NormalizedResourceSubtreeHookPolicy;
  events?: NormalizedResourceSubtreeEventPolicy;
  tags?: NormalizedResourceSubtreeTagPolicy;
  taskMiddleware?: NormalizedResourceSubtreeTaskMiddlewarePolicy;
  resourceMiddleware?: NormalizedResourceSubtreeResourceMiddlewarePolicy;
  validate?: SubtreeElementValidator[];
};

export type SubtreePolicyOptions = {
  override?: boolean;
};

export type ResourceSubtreePolicyValue = ResourceSubtreePolicy;

export type ResourceSubtreePolicyList =
  | ResourceSubtreePolicyValue
  | ResourceSubtreePolicyValue[];

export type ResourceSubtreePolicyResolver<TConfig = unknown> = (
  config: TConfig,
) => ResourceSubtreePolicyList;

export type ResourceSubtreePolicyInput<TConfig = unknown> =
  | ResourceSubtreePolicyList
  | ResourceSubtreePolicyResolver<TConfig>;

export type ResourceSubtreePolicyDeclaration<TConfig = unknown> = {
  policy: ResourceSubtreePolicyInput<TConfig>;
  options?: SubtreePolicyOptions;
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
