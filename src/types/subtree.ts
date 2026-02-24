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

export type SubtreeTaskValidator = (
  taskDefinition: ITask<any, any, any, any, any, any>,
) => SubtreeViolation[];

export type SubtreeResourceValidator = (
  resourceDefinition: IResource<any, any, any, any, any, any, any>,
) => SubtreeViolation[];

export type SubtreeHookValidator = (
  hookDefinition: IHook<any, any, any>,
) => SubtreeViolation[];

export type SubtreeTaskMiddlewareValidator = (
  middlewareDefinition: ITaskMiddleware<any, any, any, any>,
) => SubtreeViolation[];

export type SubtreeResourceMiddlewareValidator = (
  middlewareDefinition: IResourceMiddleware<any, any, any, any>,
) => SubtreeViolation[];

export type SubtreeEventValidator = (
  eventDefinition: IEvent<any>,
) => SubtreeViolation[];

export type SubtreeTagValidator = (
  tagDefinition: ITag<any, any, any, any>,
) => SubtreeViolation[];

export type ResourceSubtreeTaskPolicy = {
  middleware?: TaskMiddlewareAttachmentType[];
  validate?: SubtreeTaskValidator | SubtreeTaskValidator[];
};

export type ResourceSubtreeResourcePolicy = {
  middleware?: ResourceMiddlewareAttachmentType[];
  validate?: SubtreeResourceValidator | SubtreeResourceValidator[];
};

export type ResourceSubtreeHookPolicy = {
  validate?: SubtreeHookValidator | SubtreeHookValidator[];
};

export type ResourceSubtreeTaskMiddlewarePolicy = {
  validate?: SubtreeTaskMiddlewareValidator | SubtreeTaskMiddlewareValidator[];
};

export type ResourceSubtreeResourceMiddlewarePolicy = {
  validate?:
    | SubtreeResourceMiddlewareValidator
    | SubtreeResourceMiddlewareValidator[];
};

export type ResourceSubtreeEventPolicy = {
  validate?: SubtreeEventValidator | SubtreeEventValidator[];
};

export type ResourceSubtreeTagPolicy = {
  validate?: SubtreeTagValidator | SubtreeTagValidator[];
};

export type ResourceSubtreePolicy = {
  tasks?: ResourceSubtreeTaskPolicy;
  resources?: ResourceSubtreeResourcePolicy;
  hooks?: ResourceSubtreeHookPolicy;
  taskMiddleware?: ResourceSubtreeTaskMiddlewarePolicy;
  resourceMiddleware?: ResourceSubtreeResourceMiddlewarePolicy;
  events?: ResourceSubtreeEventPolicy;
  tags?: ResourceSubtreeTagPolicy;
};

export type NormalizedResourceSubtreeTaskPolicy = {
  middleware: TaskMiddlewareAttachmentType[];
  validate: SubtreeTaskValidator[];
};

export type NormalizedResourceSubtreeResourcePolicy = {
  middleware: ResourceMiddlewareAttachmentType[];
  validate: SubtreeResourceValidator[];
};

export type NormalizedResourceSubtreeHookPolicy = {
  validate: SubtreeHookValidator[];
};

export type NormalizedResourceSubtreeTaskMiddlewarePolicy = {
  validate: SubtreeTaskMiddlewareValidator[];
};

export type NormalizedResourceSubtreeResourceMiddlewarePolicy = {
  validate: SubtreeResourceMiddlewareValidator[];
};

export type NormalizedResourceSubtreeEventPolicy = {
  validate: SubtreeEventValidator[];
};

export type NormalizedResourceSubtreeTagPolicy = {
  validate: SubtreeTagValidator[];
};

export type NormalizedResourceSubtreePolicy = {
  tasks?: NormalizedResourceSubtreeTaskPolicy;
  resources?: NormalizedResourceSubtreeResourcePolicy;
  hooks?: NormalizedResourceSubtreeHookPolicy;
  taskMiddleware?: NormalizedResourceSubtreeTaskMiddlewarePolicy;
  resourceMiddleware?: NormalizedResourceSubtreeResourceMiddlewarePolicy;
  events?: NormalizedResourceSubtreeEventPolicy;
  tags?: NormalizedResourceSubtreeTagPolicy;
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
