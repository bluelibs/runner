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
