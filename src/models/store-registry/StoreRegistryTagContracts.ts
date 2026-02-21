import {
  EventStoreElementType,
  HookStoreElementType,
  ITag,
  ResourceMiddlewareStoreElementType,
  ResourceStoreElementType,
  TaskMiddlewareStoreElementType,
  TaskStoreElementType,
} from "../../defs";
import { IErrorHelper } from "../../types/error";

export type TagIndexedCollections = {
  tasks: Map<string, TaskStoreElementType>;
  resources: Map<string, ResourceStoreElementType>;
  events: Map<string, EventStoreElementType>;
  hooks: Map<string, HookStoreElementType>;
  taskMiddlewares: Map<string, TaskMiddlewareStoreElementType>;
  resourceMiddlewares: Map<string, ResourceMiddlewareStoreElementType>;
  errors: Map<string, IErrorHelper<any>>;
  tags: Map<string, ITag<any, any, any>>;
};
