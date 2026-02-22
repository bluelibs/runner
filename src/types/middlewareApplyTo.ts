import type { IResource } from "./resource";
import type { ITask } from "./task";

export type MiddlewareApplyToScopeType = "where-visible" | "subtree";

export type TaskMiddlewareApplyToWhen = (
  task: ITask<any, any, any, any>,
) => boolean;

export type ResourceMiddlewareApplyToWhen = (
  resource: IResource<any, any, any, any, any>,
) => boolean;

export type TaskMiddlewareApplyTo = Readonly<{
  scope: MiddlewareApplyToScopeType;
  when?: TaskMiddlewareApplyToWhen;
}>;

export type ResourceMiddlewareApplyTo = Readonly<{
  scope: MiddlewareApplyToScopeType;
  when?: ResourceMiddlewareApplyToWhen;
}>;
