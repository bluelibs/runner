import type {
  EventStoreElementType,
  HookStoreElementType,
  ITag,
  ResourceMiddlewareStoreElementType,
  ResourceStoreElementType,
  TagType,
  TaskMiddlewareStoreElementType,
  TaskStoreElementType,
} from "../../defs";
import type { IErrorHelper } from "../../types/error";

export type StoringMode = "normal" | "override";

export enum IndexedTagCategory {
  Tasks = "tasks",
  Resources = "resources",
  Events = "events",
  Hooks = "hooks",
  TaskMiddlewares = "taskMiddlewares",
  ResourceMiddlewares = "resourceMiddlewares",
  Errors = "errors",
}

export type TagIndexBucket = Record<IndexedTagCategory, Set<string>>;

export const indexedTagCategories: readonly IndexedTagCategory[] = [
  IndexedTagCategory.Tasks,
  IndexedTagCategory.Resources,
  IndexedTagCategory.Events,
  IndexedTagCategory.Hooks,
  IndexedTagCategory.TaskMiddlewares,
  IndexedTagCategory.ResourceMiddlewares,
  IndexedTagCategory.Errors,
];

export const createTagIndexBucket = (): TagIndexBucket => ({
  [IndexedTagCategory.Tasks]: new Set<string>(),
  [IndexedTagCategory.Resources]: new Set<string>(),
  [IndexedTagCategory.Events]: new Set<string>(),
  [IndexedTagCategory.Hooks]: new Set<string>(),
  [IndexedTagCategory.TaskMiddlewares]: new Set<string>(),
  [IndexedTagCategory.ResourceMiddlewares]: new Set<string>(),
  [IndexedTagCategory.Errors]: new Set<string>(),
});

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

export function normalizeTags(tags: unknown): TagType[] {
  if (!Array.isArray(tags) || tags.length === 0) {
    return [];
  }

  const normalized: TagType[] = [];
  for (const candidate of tags) {
    if (
      candidate &&
      typeof candidate === "object" &&
      "id" in candidate &&
      typeof (candidate as { id?: unknown }).id === "string"
    ) {
      normalized.push(candidate as TagType);
    }
  }

  return normalized;
}
