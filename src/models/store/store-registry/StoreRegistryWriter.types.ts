import type {
  EventStoreElementType,
  HookStoreElementType,
  ITag,
  ResourceMiddlewareStoreElementType,
  ResourceStoreElementType,
  TaskMiddlewareStoreElementType,
  TaskStoreElementType,
} from "../../../defs";
import type { IAsyncContext } from "../../../types/asyncContext";
import type { IErrorHelper } from "../../../types/error";

export type StoreRegistryCollections = {
  tasks: Map<string, TaskStoreElementType>;
  resources: Map<string, ResourceStoreElementType>;
  events: Map<string, EventStoreElementType>;
  taskMiddlewares: Map<string, TaskMiddlewareStoreElementType>;
  resourceMiddlewares: Map<string, ResourceMiddlewareStoreElementType>;
  hooks: Map<string, HookStoreElementType>;
  tags: Map<string, ITag<any, any, any>>;
  asyncContexts: Map<string, IAsyncContext<any>>;
  errors: Map<string, IErrorHelper<any>>;
};

export type StoreRegistryValidation = {
  checkIfIDExists: (id: string) => void;
  trackRegisteredId: (id: string) => void;
};

export type StoreRegistryAliasResolver = {
  registerDefinitionAlias: (reference: unknown, canonicalId: string) => void;
  resolveDefinitionId: (reference: unknown) => string | undefined;
};
